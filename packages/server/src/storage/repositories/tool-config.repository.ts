import type { IStorageDriver } from "../drivers/base.driver.js";

const COLLECTION = "tool_configs";

/**
 * 工具配置实体（TASK-019 启停；TASK-026 扩展 per-tool 覆盖，向后兼容）。
 * 语义（v1 全局层）：缺记录 = 启用且无覆盖（默认全启）；deny-wins 的会话覆盖层
 * （SessionEntity.disabledTools）为预留扩展，本仓库不涉及。
 */
export interface ToolConfigEntity {
  /** 与 HarnessTool.name 一致，作为存储键 */
  name: string;
  enabled: boolean;
  /**
   * per-tool 超时覆盖（毫秒，可选）。bash_run：替换默认 30s 命令超时
   * （仍受 tools.bashTimeoutCeilingMs 封顶）；其他工具：替换执行器 60s 超时上限。
   */
  timeoutMs?: number;
  /**
   * per-tool 审批覆盖（可选，deny-wins）：true 追加 HITL 审批（提升生效）；
   * false 不放宽既有推导（requiresApproval/riskLevel==="high" 的安全项只能升不能降）。
   */
  requiresApproval?: boolean;
  updatedAt: number;
}

export class ToolConfigRepository {
  constructor(private driver: IStorageDriver) {}

  async get(name: string): Promise<ToolConfigEntity | null> {
    return this.driver.get<ToolConfigEntity>(COLLECTION, name);
  }

  async list(): Promise<ToolConfigEntity[]> {
    return this.driver.list<ToolConfigEntity>(COLLECTION);
  }

  /**
   * 被禁用的工具名集合：仅 enabled === false 的记录构成。
   * 未配置过（缺记录）与显式 enabled=true 的工具均视为启用。
   */
  async disabledNames(): Promise<Set<string>> {
    const all = await this.list();
    return new Set(all.filter((c) => c.enabled === false).map((c) => c.name));
  }

  /**
   * 设置启停（upsert）。禁用写记录；重新启用覆盖为 enabled=true
   * （保留 updatedAt 审计痕迹与既有 per-tool 覆盖，语义上与「缺记录=启用」等价）。
   */
  async setEnabled(name: string, enabled: boolean): Promise<ToolConfigEntity> {
    return this.update(name, { enabled });
  }

  /**
   * 合并更新（upsert，TASK-026）：只覆盖传入字段，未传字段保留既有值
   * （缺记录时以 { enabled: true } 为基底）。enabled 缺省不改动既有启停状态。
   */
  async update(
    name: string,
    patch: { enabled?: boolean; timeoutMs?: number; requiresApproval?: boolean }
  ): Promise<ToolConfigEntity> {
    const existing = await this.get(name);
    const entity: ToolConfigEntity = {
      name,
      enabled: patch.enabled ?? existing?.enabled ?? true,
      ...(existing?.timeoutMs !== undefined ? { timeoutMs: existing.timeoutMs } : {}),
      ...(existing?.requiresApproval !== undefined
        ? { requiresApproval: existing.requiresApproval }
        : {}),
      updatedAt: Date.now(),
    };
    if (patch.timeoutMs !== undefined) entity.timeoutMs = patch.timeoutMs;
    if (patch.requiresApproval !== undefined) entity.requiresApproval = patch.requiresApproval;
    await this.driver.set(COLLECTION, name, entity);
    return entity;
  }
}
