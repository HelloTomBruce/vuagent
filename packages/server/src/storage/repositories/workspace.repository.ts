import path from "node:path";
import type { IStorageDriver } from "../drivers/base.driver.js";
import type { WorkspaceEntity, WorkspacePermission } from "../interfaces.js";

const COLLECTION = "workspaces";

export class WorkspaceRepository {
  constructor(private driver: IStorageDriver) {}

  async create(data: Omit<WorkspaceEntity, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<WorkspaceEntity> {
    const id = data.id || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const entity: WorkspaceEntity = {
      ...data,
      id,
      rootPath: path.resolve(data.rootPath),
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.set(COLLECTION, id, entity);
    return entity;
  }

  async get(id: string): Promise<WorkspaceEntity | null> {
    return this.driver.get<WorkspaceEntity>(COLLECTION, id);
  }

  async list(): Promise<WorkspaceEntity[]> {
    return this.driver.list<WorkspaceEntity>(COLLECTION);
  }

  async update(id: string, updates: Partial<Omit<WorkspaceEntity, "id" | "createdAt">>): Promise<WorkspaceEntity | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: WorkspaceEntity = {
      ...existing,
      ...updates,
      rootPath: updates.rootPath ? path.resolve(updates.rootPath) : existing.rootPath,
      updatedAt: Date.now(),
    };
    await this.driver.set(COLLECTION, id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.driver.delete(COLLECTION, id);
  }

  /**
   * 安全沙箱：验证目标路径是否在工作区 rootPath 范围之内，杜绝路径穿越攻击 (../)
   */
  async resolveSafePath(workspaceId: string, relativeOrAbsolutePath: string): Promise<string> {
    const ws = await this.get(workspaceId);
    if (!ws) {
      throw new Error(`Workspace [${workspaceId}] not found`);
    }

    const resolved = path.isAbsolute(relativeOrAbsolutePath)
      ? path.resolve(relativeOrAbsolutePath)
      : path.resolve(ws.rootPath, relativeOrAbsolutePath);

    const relative = path.relative(ws.rootPath, resolved);
    const isInside = !relative.startsWith("..") && !path.isAbsolute(relative);

    if (!isInside && resolved !== ws.rootPath) {
      throw new Error(
        `[Security Violation] Path [${relativeOrAbsolutePath}] is outside workspace boundary [${ws.rootPath}]`
      );
    }

    return resolved;
  }

  /**
   * 权限校验
   */
  async assertPermission(workspaceId: string, required: WorkspacePermission): Promise<void> {
    const ws = await this.get(workspaceId);
    if (!ws) {
      throw new Error(`Workspace [${workspaceId}] not found`);
    }

    const rank: Record<WorkspacePermission, number> = {
      "read-only": 1,
      "read-write": 2,
      danger: 3,
    };

    if (rank[ws.permission] < rank[required]) {
      throw new Error(
        `[Permission Denied] Workspace [${workspaceId}] has permission [${ws.permission}], but [${required}] is required.`
      );
    }
  }
}
