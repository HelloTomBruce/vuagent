/**
 * 供应商仓储：ProviderEntity 的 CRUD + 存量数据惰性迁移
 *
 * 背景（P0 模型设置重构）：
 *   旧模型把「供应商端点 + 凭证 + 模型标识」打包成一条 model_profiles 记录，
 *   导致同一供应商下配置第二个模型时必须复制整条配置（含明文密钥）。
 *   新模型拆成两层：
 *     ProviderEntity（端点/凭证/协议，1 份） ──1:N── ModelProfileEntity（模型标识/能力）
 *
 * 兼容策略：
 *   存量 profile 没有 providerId，首次读取供应商列表时按
 *   (provider 类型 + baseUrl + apiKey) 三元组归组，自动生成对应的 provider 并回填
 *   providerId，从而把「N 条重复配置」收敛成「1 个 provider + N 个模型」。
 *   迁移是幂等的：已回填的记录不会被重复处理。
 */
import { providerPreset } from "@vuagent/protocol";
import type { IStorageDriver } from "../drivers/base.driver.js";
import type { ModelProfileEntity, ProviderEntity, ProviderKind } from "../interfaces.js";
import { maskApiKey } from "../../security.js";

const PROVIDER_COLLECTION = "providers";
const PROFILE_COLLECTION = "model_profiles";

/**
 * 供应商默认显示名：直接取预设表的 label。
 * 此前这里有一份 6 家的手写映射（`Record<ProviderKind, string>`），供应商扩到 24 家后
 * 新增 id 拿不到名字（undefined）——删表改由预设提供（评审 R1）。
 */
function providerDefaultName(kind: ProviderKind): string {
  return providerPreset(kind).label;
}

export class ProviderRepository {
  /**
   * 迁移互斥锁。
   *
   * 迁移是「读全表 → 判断 → 建 provider → 回填」的非原子序列，并发触发会各自
   * 建出同名 provider（实测：并发 3 次 → 3 个重复供应商）。用进程内 promise 锁
   * 串行化：后到的调用直接复用前一次的结果。
   */
  private migrationLock: Promise<{ created: number; adopted: number }> | null = null;

  constructor(private driver: IStorageDriver) {}

  async listProviders(): Promise<ProviderEntity[]> {
    await this.ensureMigrated();
    return this.driver.list<ProviderEntity>(PROVIDER_COLLECTION);
  }

  /**
   * 幂等且并发安全的迁移入口。
   *
   * 不用「已迁移」永久标记：旧路由 POST /api/settings/models 仍可能在后续创建
   * 无 providerId 的孤儿记录，永久标记会漏掉它们。migrateLegacyProfiles 在没有
   * 遗留数据时只做一次全表 filter 就返回，数据量在数十条级别，代价可忽略。
   */
  async ensureMigrated(): Promise<{ created: number; adopted: number }> {
    if (this.migrationLock) return this.migrationLock;
    this.migrationLock = this.migrateLegacyProfiles().finally(() => {
      this.migrationLock = null;
    });
    return this.migrationLock;
  }

  async getProvider(id: string): Promise<ProviderEntity | null> {
    return this.driver.get<ProviderEntity>(PROVIDER_COLLECTION, id);
  }

  async createProvider(
    data: Omit<ProviderEntity, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Promise<ProviderEntity> {
    const now = Date.now();
    const entity: ProviderEntity = {
      ...data,
      id: data.id || `prov-${now}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.set(PROVIDER_COLLECTION, entity.id, entity);
    return entity;
  }

  /**
   * 更新供应商。apiKey 处理与 profile 一致（TASK-011 安全基线）：
   *   - 空值 / 与已存掩码完全相等 = 保留原密钥（前端拿不到明文）
   *   - maskedApiKey 是回显字段，永不落库
   */
  async updateProvider(
    id: string,
    updates: Partial<Omit<ProviderEntity, "id" | "createdAt">>
  ): Promise<ProviderEntity | null> {
    const existing = await this.getProvider(id);
    if (!existing) return null;

    const { maskedApiKey: _maskedIgnored, ...rest } = updates as Partial<ProviderEntity> & {
      maskedApiKey?: string;
    };
    if (!rest.apiKey || rest.apiKey === maskApiKey(existing.apiKey)) {
      delete rest.apiKey;
    }

    const updated: ProviderEntity = { ...existing, ...rest, updatedAt: Date.now() };
    await this.driver.set(PROVIDER_COLLECTION, id, updated);
    return updated;
  }

  /**
   * 删除供应商。默认拒绝「仍挂着模型的供应商」，避免模型变成孤儿配置；
   * cascade=true 时连带删除其下所有模型。
   */
  async deleteProvider(
    id: string,
    options: { cascade?: boolean } = {}
  ): Promise<{ deleted: boolean; removedModels: number; boundModels?: number; reason?: string }> {
    const existing = await this.getProvider(id);
    if (!existing) return { deleted: false, removedModels: 0, reason: "not_found" };

    const models = await this.driver.list<ModelProfileEntity>(PROFILE_COLLECTION);
    const bound = models.filter((m) => m.providerId === id);

    if (bound.length > 0 && !options.cascade) {
      // 用结构化字段告知调用方，而不是让上层去 split 字符串
      return {
        deleted: false,
        removedModels: 0,
        boundModels: bound.length,
        reason: "provider_has_models",
      };
    }

    for (const m of bound) {
      await this.driver.delete(PROFILE_COLLECTION, m.id);
    }
    await this.driver.delete(PROVIDER_COLLECTION, id);
    return { deleted: true, removedModels: bound.length };
  }

  /** 某供应商下的模型列表 */
  async listModelsOf(providerId: string): Promise<ModelProfileEntity[]> {
    const all = await this.driver.list<ModelProfileEntity>(PROFILE_COLLECTION);
    return all.filter((m) => m.providerId === providerId);
  }

  /**
   * 存量数据迁移（幂等）：把没有 providerId 的 profile 按
   * (provider + baseUrl + apiKey) 归组，生成 provider 并回填 providerId。
   *
   * 归组键为什么含 baseUrl/apiKey：旧结构下同一 provider 类型可能配了多个
   * 不同端点（如两个自建 OpenAI 兼容服务），只按 provider 类型归组会把
   * 凭证不同的配置错误合并，造成串号。
   *
   * 并发安全由 ensureMigrated() 保证；本方法不应在锁外被并发调用。
   */
  async migrateLegacyProfiles(): Promise<{ created: number; adopted: number }> {
    const profiles = await this.driver.list<ModelProfileEntity>(PROFILE_COLLECTION);
    const legacy = profiles.filter((p) => !p.providerId);
    if (legacy.length === 0) return { created: 0, adopted: 0 };

    const existingProviders = await this.driver.list<ProviderEntity>(PROVIDER_COLLECTION);

    // 归组键 → provider id
    const keyToProviderId = new Map<string, string>();
    for (const prov of existingProviders) {
      keyToProviderId.set(this.groupKey(prov.provider, prov.baseUrl, prov.apiKey), prov.id);
    }

    let created = 0;
    let adopted = 0;

    for (const profile of legacy) {
      const key = this.groupKey(profile.provider, profile.baseUrl, profile.apiKey);
      let providerId = keyToProviderId.get(key);

      if (!providerId) {
        const now = Date.now();
        const provider: ProviderEntity = {
          id: `prov-${now}-${Math.random().toString(36).slice(2, 7)}`,
          name: this.providerNameFor(profile),
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          parameters: profile.parameters ? { ...profile.parameters } : undefined,
          createdAt: now,
          updatedAt: now,
        };
        await this.driver.set(PROVIDER_COLLECTION, provider.id, provider);
        providerId = provider.id;
        keyToProviderId.set(key, providerId);
        created += 1;
      }

      // 回填 providerId。刻意保留模型上的 baseUrl/apiKey 原值：
      //   1) 迁移可回滚，删掉 provider 记录即可还原旧结构
      //   2) 读取时 provider 值优先（见 SettingsRepository.hydrateProfile），
      //      因此「改供应商密钥 → 全组模型生效」的语义不受残留字段影响
      const migrated: ModelProfileEntity = {
        ...profile,
        providerId,
        updatedAt: Date.now(),
      };
      await this.driver.set(PROFILE_COLLECTION, migrated.id, migrated);
      adopted += 1;
    }

    return { created, adopted };
  }

  private groupKey(provider: string, baseUrl?: string, apiKey?: string): string {
    return `${provider}|${(baseUrl || "").trim()}|${apiKey || ""}`;
  }

  private providerNameFor(profile: ModelProfileEntity): string {
    const base = providerDefaultName(profile.provider) || profile.provider;
    // 同一类型存在多个端点时，用 baseUrl 尾部加以区分，避免出现多个同名分组
    if (profile.baseUrl) {
      try {
        const host = new URL(profile.baseUrl).host;
        return `${base} (${host})`;
      } catch {
        return `${base} (${profile.baseUrl})`;
      }
    }
    return base;
  }
}
