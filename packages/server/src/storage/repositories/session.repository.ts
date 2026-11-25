import type { IStorageDriver } from "../drivers/base.driver.js";
import { supportsPrefixList } from "../drivers/base.driver.js";
import type { SessionEntity, TurnEntity, CheckpointEntity, SessionStatus } from "../interfaces.js";

const COLLECTION = "sessions";
/** TASK-092：轮次独立集合——主文档不再内联 turns（写放大根因） */
const TURNS_COLLECTION = "session_turns";

/** turn 行包装：index 为会话内顺序（迁移按旧数组序赋值，append 递增） */
interface TurnRow {
  index: number;
  turn: TurnEntity;
}

/** 行键 = `${sessionId}:${turnId}`（冒号分隔）；前缀查询/分组共用此前缀 */
const turnKey = (sessionId: string, turnId: string): string => `${sessionId}:${turnId}`;
const turnKeyPrefix = (sessionId: string): string => `${sessionId}:`;

/**
 * 会话仓储（TASK-092 拆表迁移）：
 *
 * 旧模型：session 单文档内嵌全部 turns+checkpoints——appendTurn/updateTurn 每次
 * 读全量→改→写全量，会话越大写放大越严重（node:sqlite 同步写阻塞事件循环）。
 *
 * 新模型：主文档只存元数据（turns: [] + turnCount + turnsSplit 标记），每个 turn
 * 一行（collection "session_turns"，id = `${sessionId}:${turnId}`，包装 index 保序）——
 * updateTurn/recordCheckpoint 变为单行读写（O(turn)），不再重写整会话。
 *
 * 兼容策略（读时合并 + 首写惰性迁移，迁移状态以显式标记判定）：
 * - 旧格式文档（无 turnsSplit 标记且内联非空 turns）：get/list 读时原样合并返回，
 *   **只读不迁移**；
 * - 任一轮次写路径（appendTurn/updateTurn/recordCheckpoint/replaceTurns）首次触达时
 *   把内联 turns 一次性搬进行存储，主文档清空 turns、落 turnCount 并写 turnsSplit
 *   标记，此后走新模型；
 * - 写路径一律直读 raw 主文档（driver.get），**绝不使用 assemble 水合实体**——
 *   水合产物曾被「内联非空 turns」启发式误判为 legacy，导致重复搬库与全量回写
 *   （存储域审查 C2/R1）；
 * - 元数据写路径（update/updateStatus）基于 raw 透传 turnsSplit/turnCount，
 *   不触发迁移、不丢内联 turns；
 * - 仓储接口不变，AgentLoop/Hub/路由层无感。
 */
export class SessionRepository {
  constructor(private driver: IStorageDriver) {}

  async create(data: {
    id?: string;
    workspaceId: string;
    title?: string;
    activeModelProfileId?: string;
    permission?: string;
    systemContext?: string;
  }): Promise<SessionEntity> {
    const id = data.id || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const entity: SessionEntity = {
      id,
      workspaceId: data.workspaceId,
      title: data.title || "新建 Agent 对话",
      status: "active",
      activeModelProfileId: data.activeModelProfileId,
      permission: data.permission,
      systemContext: data.systemContext,
      turns: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.set(COLLECTION, id, entity);
    return entity;
  }

  /** 主文档是否仍是旧格式：无 turnsSplit 标记且内联非空 turns（C2：标记在则恒 false） */
  private static isLegacyInline(session: SessionEntity): boolean {
    return !session.turnsSplit && Array.isArray(session.turns) && session.turns.length > 0;
  }

  /** 主文档残留非空内联 turns（无论是否带标记）——读兜底用「内联为准」防读到空会话 */
  private static hasInlineTurns(session: SessionEntity): boolean {
    return Array.isArray(session.turns) && session.turns.length > 0;
  }

  /**
   * 写路径前置：旧格式文档一次性搬库——内联 turns 全部写行存储（保持原数组序），
   * 主文档 turns 清空 + 记录 turnCount + 写 turnsSplit 标记。幂等（迁完即非 legacy）。
   * 调用方必须接住返回值：turnCount 等迁移产物以返回值为准落库（R1）。
   */
  private async ensureMigrated(session: SessionEntity): Promise<SessionEntity> {
    if (!SessionRepository.isLegacyInline(session)) return session;
    const turns = session.turns;
    for (let i = 0; i < turns.length; i++) {
      await this.driver.set(TURNS_COLLECTION, turnKey(session.id, turns[i].id), {
        index: i,
        turn: turns[i],
      } satisfies TurnRow);
    }
    const migrated: SessionEntity = {
      ...session,
      turns: [],
      // 存储元数据（SessionEntity 可选字段，见 interfaces.ts 注释）
      turnCount: turns.length,
      // C2：显式存储标记——此后 isLegacyInline 恒 false，写路径不再重复搬库
      turnsSplit: true,
      updatedAt: Date.now(),
    };
    await this.driver.set(COLLECTION, session.id, migrated);
    return migrated;
  }

  /**
   * R2：单会话行读取——驱动具备 listByPrefix（duck-type 可选能力，见
   * base.driver.ts）时按 `${sessionId}:` 前缀下推，否则回落全量 list。
   */
  private async listTurnRows(sessionId: string): Promise<TurnRow[]> {
    if (supportsPrefixList(this.driver)) {
      return this.driver.listByPrefix<TurnRow>(TURNS_COLLECTION, turnKeyPrefix(sessionId));
    }
    return this.driver.list<TurnRow>(TURNS_COLLECTION);
  }

  /** 行数组 → 保序 turns（按行内 sessionId 精确过滤，index 升序） */
  private static turnsFromRows(rows: TurnRow[], sessionId: string): TurnEntity[] {
    return rows
      .filter((r) => r?.turn?.sessionId === sessionId && typeof r.index === "number")
      .sort((a, b) => a.index - b.index)
      .map((r) => r.turn);
  }

  /**
   * 组装完整会话：主文档 + 行存储 turns（读兼容，只读不迁移）。
   * - 残留非空内联 turns 的文档一律「内联为准」原样返回：无标记旧格式是读时
   *   合并语义（只读不迁移）；有标记但残留内联属理论不存在态，保守兜底防读到
   *   空会话；
   * - 其余（有标记已清空 / 无标记内联为空的存量文档）走行装配——后者兼容修复
   *   前 bug 版本写入的「无标记 + 行存储已有行」数据（该形态在本仓储自身写入
   *   路径下也持续存在，见 appendTurn 不写标记的主文档透传）；
   * - rowsBySession 传入时（list 批量装配）为权威行集：缺键 = 该会话无行，
   *   回落空数组而非逐 doc 再读，避免空会话重触发全表扫描。
   */
  private async assemble(
    doc: SessionEntity,
    rowsBySession?: Map<string, TurnRow[]>
  ): Promise<SessionEntity> {
    if (SessionRepository.hasInlineTurns(doc)) return doc;
    const rows = rowsBySession
      ? (rowsBySession.get(doc.id) ?? [])
      : await this.listTurnRows(doc.id);
    return { ...doc, turns: SessionRepository.turnsFromRows(rows, doc.id) };
  }

  async get(id: string): Promise<SessionEntity | null> {
    const doc = await this.driver.get<SessionEntity>(COLLECTION, id);
    if (!doc) return null;
    return this.assemble(doc);
  }

  async list(filter?: (sess: SessionEntity) => boolean): Promise<SessionEntity[]> {
    const docs = await this.driver.list<SessionEntity>(COLLECTION);
    // R2 读放大修复：行存储一次全量读 + 按 turn.sessionId 分组，再逐 doc 装配；
    // 禁止逐 doc 各扫一遍全表（原实现 O(docs × rows)）。
    const rowsBySession = new Map<string, TurnRow[]>();
    const needAssembly = docs.filter((doc) => !SessionRepository.hasInlineTurns(doc));
    if (needAssembly.length > 0) {
      for (const row of await this.driver.list<TurnRow>(TURNS_COLLECTION)) {
        if (!row?.turn?.sessionId || typeof row.index !== "number") continue;
        const bucket = rowsBySession.get(row.turn.sessionId);
        if (bucket) bucket.push(row);
        else rowsBySession.set(row.turn.sessionId, [row]);
      }
    }
    const merged: SessionEntity[] = [];
    for (const doc of docs) {
      const full = await this.assemble(doc, rowsBySession);
      if (!filter || filter(full)) merged.push(full);
    }
    return merged;
  }

  /**
   * 轻量列表（TASK-093 会话列表瘦身的数据源）：只返回主文档元数据（turns: []），
   * 不装配轮次行——列表页不需要每个会话的全部 turns。
   */
  async listMeta(filter?: (sess: SessionEntity) => boolean): Promise<SessionEntity[]> {
    const docs = await this.driver.list<SessionEntity>(COLLECTION);
    if (!filter) return docs;
    return docs.filter(filter);
  }

  async update(id: string, updates: Partial<Omit<SessionEntity, "id" | "createdAt">>): Promise<SessionEntity | null> {
    // C2/R1：直读 raw 主文档（不 assemble）——水合实体会伪装 legacy，把行存储
    // turns 全量回写进主文档（写放大 + 状态机失效）。迁移判定与写入都基于 raw。
    const raw = await this.driver.get<SessionEntity>(COLLECTION, id);
    if (!raw) return null;
    const { turns: _turns, ...metadataUpdates } = updates as Partial<SessionEntity>;
    void _turns;
    const updated: SessionEntity = {
      ...raw,
      ...metadataUpdates,
      // legacy 文档保留内联 turns（元数据路径不触发迁移）；新格式恒 []。
      // turnsSplit 随 raw 透传保留（若有）
      turns: SessionRepository.isLegacyInline(raw) ? raw.turns : [],
      turnCount: raw.turnCount,
      updatedAt: Date.now(),
    };
    await this.driver.set(COLLECTION, id, updated);
    return updated;
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    // C2/R1：同 update()——基于 raw，绝不回写水合 turns
    const raw = await this.driver.get<SessionEntity>(COLLECTION, id);
    if (!raw) return;
    const { turns: _turns, ...metadata } = raw;
    void _turns;
    await this.driver.set(COLLECTION, id, {
      ...metadata,
      status,
      turns: SessionRepository.isLegacyInline(raw) ? raw.turns : [],
      turnCount: raw.turnCount,
      updatedAt: Date.now(),
    });
  }

  async appendTurn(id: string, turn: TurnEntity): Promise<void> {
    // C2：直读 raw（不 get 水合）——水合实体会伪装 legacy 触发整会话重复搬库
    const raw = await this.driver.get<SessionEntity>(COLLECTION, id);
    if (!raw) {
      throw new Error(`Session [${id}] not found`);
    }
    const session = await this.ensureMigrated(raw);

    // upsert by turn id：已存在（running 行 → 终态替换 / 进度更新）保持原 index
    const existingKey = turnKey(id, turn.id);
    const existingRow = await this.driver.get<TurnRow>(TURNS_COLLECTION, existingKey);
    const index = existingRow ? existingRow.index : (session.turnCount ?? session.turns.length ?? 0);

    await this.driver.set(TURNS_COLLECTION, existingKey, { index, turn } satisfies TurnRow);
    // 主文档只碰元数据（轻量）：turnCount 递增仅在新增时；turnsSplit 随迁移产物透传
    const { turns: _legacy, ...meta } = session;
    void _legacy;
    await this.driver.set(COLLECTION, id, {
      ...meta,
      turns: [],
      turnCount: existingRow ? (session.turnCount ?? index + 1) : index + 1,
      updatedAt: Date.now(),
    });
  }

  /**
   * 增量更新指定轮次（TASK-049 即时落库 + TASK-092 拆表后 O(turn)）：
   * 直接读写单行，不再经全量会话文档。轮次不存在时静默 no-op（best-effort；
   * 终态 appendTurn upsert 兜底保证最终落库）。旧格式文档先惰性迁移。
   */
  async updateTurn(
    id: string,
    turnId: string,
    patch: Partial<Omit<TurnEntity, "id" | "sessionId">>
  ): Promise<void> {
    const raw = await this.driver.get<SessionEntity>(COLLECTION, id);
    if (!raw) return;
    // R1：接住 ensureMigrated 返回值——turnCount/turnsSplit 以迁移后的值为准落库
    const migrated = SessionRepository.isLegacyInline(raw)
      ? await this.ensureMigrated(raw)
      : raw;
    const key = turnKey(id, turnId);
    const row = await this.driver.get<TurnRow>(TURNS_COLLECTION, key);
    if (!row) return;
    const updated: TurnRow = { index: row.index, turn: { ...row.turn, ...patch } };
    await this.driver.set(TURNS_COLLECTION, key, updated);
    // 主文档 updatedAt 触碰（轻量元数据写，保持既有语义）：基于迁移后文档透传
    await this.driver.set(COLLECTION, id, {
      ...migrated,
      updatedAt: Date.now(),
    });
  }

  async recordCheckpoint(sessionId: string, turnId: string, checkpoint: CheckpointEntity): Promise<void> {
    const raw = await this.driver.get<SessionEntity>(COLLECTION, sessionId);
    if (!raw) return;
    // R1：同 updateTurn——迁移产物以返回值为准
    const migrated = SessionRepository.isLegacyInline(raw)
      ? await this.ensureMigrated(raw)
      : raw;
    const key = turnKey(sessionId, turnId);
    const row = await this.driver.get<TurnRow>(TURNS_COLLECTION, key);
    if (!row) return;
    row.turn.checkpoints.push(checkpoint);
    await this.driver.set(TURNS_COLLECTION, key, row);
    await this.driver.set(COLLECTION, sessionId, {
      ...migrated,
      updatedAt: Date.now(),
    });
  }

  /**
   * 全量轮次回写（TASK-092 兼容通道）：崩溃恢复（recovery）与审批卡回写等
   * 「内存改完批量落库」的既有调用形态。逐行 upsert（既有行保持原 index，
   * 新行追加序号），主文档元数据触碰一次。旧格式文档先惰性迁移。
   */
  async replaceTurns(id: string, turns: TurnEntity[]): Promise<void> {
    const raw = await this.driver.get<SessionEntity>(COLLECTION, id);
    if (!raw) return;
    const migrated = await this.ensureMigrated(raw);
    // R2：本会话行集经前缀下推读取（驱动具备该能力时），不再扫全表
    const rows = await this.listTurnRows(id);
    const indexByTurnId = new Map<string, number>();
    let maxIndex = (migrated.turnCount ?? 0) - 1;
    for (const row of rows) {
      if (row?.turn?.sessionId === id && typeof row.index === "number") {
        indexByTurnId.set(row.turn.id, row.index);
        if (row.index > maxIndex) maxIndex = row.index;
      }
    }
    for (const turn of turns) {
      const existing = indexByTurnId.get(turn.id);
      const index = existing ?? ++maxIndex;
      await this.driver.set(TURNS_COLLECTION, turnKey(id, turn.id), { index, turn });
    }
    await this.driver.set(COLLECTION, id, {
      ...migrated,
      turns: [],
      turnCount: maxIndex + 1,
      updatedAt: Date.now(),
    });
  }

  async delete(id: string): Promise<boolean> {
    // 连带清理轮次行（R2：前缀下推；删除低频，回落口径同样可接受）
    const rows = await this.listTurnRows(id);
    for (const row of rows) {
      if (row?.turn?.sessionId === id) {
        await this.driver.delete(TURNS_COLLECTION, turnKey(id, row.turn.id));
      }
    }
    return this.driver.delete(COLLECTION, id);
  }
}
