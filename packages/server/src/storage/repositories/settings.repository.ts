import type { IStorageDriver } from "../drivers/base.driver.js";
import type { ModelProfileEntity } from "../interfaces.js";
import { maskApiKey } from "../../security.js";

const COLLECTION = "model_profiles";

export class SettingsRepository {
  constructor(private driver: IStorageDriver) {}

  async createProfile(data: Omit<ModelProfileEntity, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<ModelProfileEntity> {
    const id = data.id || `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const entity: ModelProfileEntity = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    if (entity.isDefault) {
      await this.unsetDefault();
    }

    await this.driver.set(COLLECTION, id, entity);
    return entity;
  }

  async getProfile(id: string): Promise<ModelProfileEntity | null> {
    return this.driver.get<ModelProfileEntity>(COLLECTION, id);
  }

  async getDefaultProfile(): Promise<ModelProfileEntity | null> {
    const list = await this.listProfiles();
    return list.find((p) => p.isDefault) || list[0] || null;
  }

  async listProfiles(): Promise<ModelProfileEntity[]> {
    const list = await this.driver.list<ModelProfileEntity>(COLLECTION);
    if (list.length === 0) {
      const defaults: (Omit<ModelProfileEntity, "id" | "createdAt" | "updatedAt"> & { id: string })[] = [
        {
          id: "deepseek-v3",
          name: "DeepSeek V3",
          provider: "deepseek",
          model: "deepseek-chat",
          contextWindow: 128000,
          isDefault: true,
        },
        {
          id: "qwen-2.5-72b",
          name: "Qwen 2.5 72B",
          provider: "qwen",
          model: "qwen-2.5-72b-instruct",
          contextWindow: 128000,
          isDefault: false,
        },
        {
          id: "claude-3-7-sonnet",
          name: "Claude 3.7 Sonnet",
          provider: "anthropic",
          model: "claude-3-7-sonnet-20250219",
          contextWindow: 200000,
          isDefault: false,
        },
        {
          id: "ollama-local",
          name: "Ollama (Local)",
          provider: "ollama",
          model: "qwen2.5-coder:7b",
          baseUrl: "http://localhost:11434/v1",
          contextWindow: 32000,
          isDefault: false,
        },
      ];
      for (const d of defaults) {
        await this.createProfile(d);
      }
      return this.driver.list<ModelProfileEntity>(COLLECTION);
    }
    return list;
  }

  async updateProfile(id: string, updates: Partial<Omit<ModelProfileEntity, "id" | "createdAt">>): Promise<ModelProfileEntity | null> {
    const existing = await this.getProfile(id);
    if (!existing) return null;

    if (updates.isDefault) {
      await this.unsetDefault();
    }

    // TASK-011 安全基线：
    // 1. 空值 apiKey（undefined/""）= 保留服务端已存密钥（脱敏回显后前端不再持有明文）
    // 2. 与已存密钥的掩码完全相等的值 = 客户端误回显脱敏值，同样视为未修改；
    //    仅以前缀判断会误伤极小概率真实以 **** 开头的新密钥，故按 maskApiKey 精确比对
    // 3. maskedApiKey 是回显掩码字段，永不落库
    const { maskedApiKey: _maskedIgnored, ...rest } = updates as Partial<ModelProfileEntity> & {
      maskedApiKey?: string;
    };
    if (!rest.apiKey || rest.apiKey === maskApiKey(existing.apiKey)) {
      delete rest.apiKey;
    }

    const updated: ModelProfileEntity = {
      ...existing,
      ...rest,
      updatedAt: Date.now(),
    };
    await this.driver.set(COLLECTION, id, updated);
    return updated;
  }

  async deleteProfile(id: string): Promise<boolean> {
    return this.driver.delete(COLLECTION, id);
  }

  private async unsetDefault(): Promise<void> {
    const profiles = await this.driver.list<ModelProfileEntity>(COLLECTION);
    for (const p of profiles) {
      if (p.isDefault) {
        p.isDefault = false;
        await this.driver.set(COLLECTION, p.id, p);
      }
    }
  }

  /**
   * 级联解析有效配置：
   * 优先级：当前请求临时覆盖 > 会话指定 Profile > 全局默认 Profile > 默认兜底
   */
  async resolveEffectiveSettings(
    sessionProfileId?: string,
    requestOverride?: Partial<ModelProfileEntity>
  ): Promise<ModelProfileEntity> {
    let base: ModelProfileEntity | null = null;

    if (sessionProfileId) {
      base = await this.getProfile(sessionProfileId);
    }

    if (!base) {
      base = await this.getDefaultProfile();
    }

    const fallback: ModelProfileEntity = {
      id: "fallback-default",
      name: "Default Fallback",
      provider: "openai",
      model: process.env.DEFAULT_MODEL || "gpt-4o",
      baseUrl: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      parameters: { temperature: 0.7 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const target = base || fallback;

    return {
      ...target,
      ...requestOverride,
      parameters: {
        ...target.parameters,
        ...requestOverride?.parameters,
      },
    };
  }
}
