import type { IStorageDriver } from "../drivers/base.driver.js";
import type { SessionEntity, TurnEntity, CheckpointEntity, SessionStatus } from "../interfaces.js";

const COLLECTION = "sessions";

export class SessionRepository {
  constructor(private driver: IStorageDriver) {}

  async create(data: {
    id?: string;
    workspaceId: string;
    title?: string;
    activeModelProfileId?: string;
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
      systemContext: data.systemContext,
      turns: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.set(COLLECTION, id, entity);
    return entity;
  }

  async get(id: string): Promise<SessionEntity | null> {
    return this.driver.get<SessionEntity>(COLLECTION, id);
  }

  async list(filter?: (sess: SessionEntity) => boolean): Promise<SessionEntity[]> {
    return this.driver.list<SessionEntity>(COLLECTION, filter);
  }

  async update(id: string, updates: Partial<Omit<SessionEntity, "id" | "createdAt">>): Promise<SessionEntity | null> {
    const session = await this.get(id);
    if (!session) return null;
    const updated: SessionEntity = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
    };
    await this.driver.set(COLLECTION, id, updated);
    return updated;
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    const session = await this.get(id);
    if (!session) return;
    session.status = status;
    session.updatedAt = Date.now();
    await this.driver.set(COLLECTION, id, session);
  }

  async appendTurn(id: string, turn: TurnEntity): Promise<void> {
    const session = await this.get(id);
    if (!session) {
      throw new Error(`Session [${id}] not found`);
    }
    const existingIndex = session.turns.findIndex((t) => t.id === turn.id);
    if (existingIndex >= 0) {
      session.turns[existingIndex] = turn;
    } else {
      session.turns.push(turn);
    }
    session.updatedAt = Date.now();
    await this.driver.set(COLLECTION, id, session);
  }

  async recordCheckpoint(sessionId: string, turnId: string, checkpoint: CheckpointEntity): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    const turn = session.turns.find((t) => t.id === turnId);
    if (!turn) return;
    turn.checkpoints.push(checkpoint);
    session.updatedAt = Date.now();
    await this.driver.set(COLLECTION, sessionId, session);
  }

  async delete(id: string): Promise<boolean> {
    return this.driver.delete(COLLECTION, id);
  }
}
