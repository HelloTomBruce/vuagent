import type { IStorageDriver } from "../drivers/base.driver.js";

const COLLECTION = "harness_config";

/**
 * 配置中心实体（TASK-024）：一个命名空间一条记录，values 为部分覆盖集。
 * 语义：缺记录 = 全默认（与 tool-config 的「缺记录=启用」同构）。
 * 解析链 v1 只做「内置默认值 < 全局配置」；scope 字段为工作区/会话覆盖层
 * 预留（与 TASK-019 数据模型预留同决策），v1 恒为 "global"。
 */
export interface HarnessConfigEntity {
  /** 命名空间 id（CONFIG_SCHEMA 的 ns.id），作为存储键 */
  namespace: string;
  /** 部分覆盖集：仅含被用户显式修改过的 key */
  values: Record<string, unknown>;
  scope: "global";
  updatedAt: number;
}

export class HarnessConfigRepository {
  constructor(private driver: IStorageDriver) {}

  async getNamespace(namespace: string): Promise<HarnessConfigEntity | null> {
    return this.driver.get<HarnessConfigEntity>(COLLECTION, namespace);
  }

  async listNamespaces(): Promise<HarnessConfigEntity[]> {
    return this.driver.list<HarnessConfigEntity>(COLLECTION);
  }

  /**
   * 合并写入（upsert）：新值与既有覆盖集做浅合并——PATCH 语义是
   * 「改哪几个 key 就只覆盖哪几个」，其余已配项不受影响。
   */
  async patchNamespace(
    namespace: string,
    values: Record<string, unknown>
  ): Promise<HarnessConfigEntity> {
    const existing = await this.getNamespace(namespace);
    const entity: HarnessConfigEntity = {
      namespace,
      values: { ...(existing?.values ?? {}), ...values },
      scope: "global",
      updatedAt: Date.now(),
    };
    await this.driver.set(COLLECTION, namespace, entity);
    return entity;
  }

  /** 恢复默认：删除记录（缺记录 = 全默认）。返回是否确有记录被删除。 */
  async resetNamespace(namespace: string): Promise<boolean> {
    return this.driver.delete(COLLECTION, namespace);
  }
}
