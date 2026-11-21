import type { IStorageDriver } from "../drivers/base.driver.js";
import type { ModelCapabilities, ModelProfileEntity } from "../interfaces.js";
import { maskApiKey } from "../../security.js";
import { ProviderRepository } from "./providers.repository.js";

const COLLECTION = "model_profiles";
/** 一次性标记集合：「默认 profile 已播种过」（防删空后复活） */
const META_COLLECTION = "settings_meta";
const SEED_FLAG_ID = "model_profiles_seeded";

export class SettingsRepository {
  /** 供应商仓储（同 driver 构造，用于凭证继承与存量迁移） */
  private providerRepo: ProviderRepository;
  /** 播种标记的进程内缓存（命中后不再查存储） */
  private seededMemo: boolean | null = null;

  constructor(private driver: IStorageDriver) {
    this.providerRepo = new ProviderRepository(driver);
  }

  /** 暴露供应商仓储给路由层复用，避免重复构造 */
  get providers(): ProviderRepository {
    return this.providerRepo;
  }

  /**
   * 把模型解析成「可运行配置」：providerId 存在时从供应商继承端点/凭证/默认参数。
   *
   * 优先级：供应商字段 > 模型自身字段（凭证唯一事实源在 provider 层）。
   * 这样在设置页改一次供应商 Key，其下所有模型立刻生效，不会被模型上的
   * 迁移残留值挡住——这是 1:N 分层最关键的行为保证。
   *
   * 遇到没有 providerId 的记录时，先触发一次（幂等 + 加锁）迁移再重读，
   * 让老数据在首次请求时自愈，而不是依赖读接口的副作用。
   */
  async hydrateProfile(profile: ModelProfileEntity): Promise<ModelProfileEntity> {
    let target = profile;

    if (!target.providerId) {
      await this.providerRepo.ensureMigrated();
      const fresh = await this.getProfile(target.id);
      if (!fresh?.providerId) return target; // 迁移后仍无归属：保持内联配置
      target = fresh;
    }

    const provider = await this.providerRepo.getProvider(target.providerId!);
    if (!provider) return target; // 供应商被删（被 delete 守卫拦住），降级为内联配置

    return {
      ...target,
      provider: provider.provider || target.provider,
      // 凭证/端点：供应商优先（唯一事实源，改一次全组生效）
      baseUrl: provider.baseUrl || target.baseUrl,
      apiKey: provider.apiKey || target.apiKey,
      contextWindow: target.contextWindow || target.capabilities?.contextWindow,
      // 参数：模型优先（模型级覆盖比供应商级默认更具体）
      parameters: {
        ...provider.parameters,
        ...target.parameters,
        // 兼容早期落库的顶层 temperature（见 normalizeProfileInput 注释）
        ...(target.parameters?.temperature === undefined && typeof target.temperature === "number"
          ? { temperature: target.temperature }
          : {}),
      },
    };
  }

  /**
   * 归一化写入参数。
   *
   * 前端（以及旧数据）会把 temperature 作为**顶层字段**传，但 agent-loop 实际
   * 读取的是 modelProfile.parameters——两者错位会导致「设置面板里调的温度
   * 永远不生效」。这里统一收敛到 parameters.temperature，顶层字段不再落库。
   *
   * 同时把 capabilities.contextWindow 镜像到顶层 contextWindow，避免两个位置
   * 出现不一致（既有读取方仍在读顶层）。
   */
  private normalizeProfileInput<T extends Partial<ModelProfileEntity>>(data: T): T {
    const out: Record<string, unknown> = { ...data };

    const legacyTemperature = typeof out.temperature === "number" ? out.temperature : undefined;
    delete out.temperature;

    const capWindow = (out.capabilities as ModelCapabilities | undefined)?.contextWindow;
    if (!out.contextWindow && capWindow) {
      out.contextWindow = capWindow;
    }
    const flatWindow = typeof out.contextWindow === "number" ? out.contextWindow : undefined;
    if (!capWindow && flatWindow && out.capabilities) {
      out.capabilities = { ...(out.capabilities as ModelCapabilities), contextWindow: flatWindow };
    }

    if (legacyTemperature !== undefined) {
      out.parameters = {
        ...((out.parameters as ModelProfileEntity["parameters"]) ?? {}),
        temperature: legacyTemperature,
      };
    }

    return out as T;
  }

  async createProfile(data: Omit<ModelProfileEntity, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<ModelProfileEntity> {
    const normalized = this.normalizeProfileInput(data);
    const id = normalized.id || `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const entity: ModelProfileEntity = {
      ...normalized,
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

  /**
   * 列出全部模型。
   *
   * 注意：迁移不在本方法做（CQS），由 ProviderRepository.ensureMigrated()
   * 在供应商读取路径统一触发。
   *
   * 默认 profile 播种只在数据库生命周期内发生一次（settings_meta 打标记）。
   * 旧逻辑「空表即播种」会在用户删光所有模型后让 4 个默认供应商不断复活
   * （播种 → 迁移归组 → 供应商列表凭空多出默认项），删掉的东西自己长回来；
   * 存量库首次读到非空表时补标记，保证之后删空同样不复活。
   */
  async listProfiles(): Promise<ModelProfileEntity[]> {
    let list = await this.driver.list<ModelProfileEntity>(COLLECTION);
    if (list.length === 0 && !(await this.seededOnce())) {
      await this.seedDefaultProfiles();
      await this.markSeeded();
      list = await this.driver.list<ModelProfileEntity>(COLLECTION);
    } else if (list.length > 0) {
      await this.markSeeded();
    }
    return list;
  }

  private async seededOnce(): Promise<boolean> {
    if (this.seededMemo !== null) return this.seededMemo;
    this.seededMemo =
      (await this.driver.get<{ at: number }>(META_COLLECTION, SEED_FLAG_ID)) !== null;
    return this.seededMemo;
  }

  private async markSeeded(): Promise<void> {
    if (await this.seededOnce()) return;
    await this.driver.set(META_COLLECTION, SEED_FLAG_ID, { at: Date.now() });
    this.seededMemo = true;
  }

  /** 首次使用播种默认 profile（固定 id，天然幂等） */
  private async seedDefaultProfiles(): Promise<void> {
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

    const normalized = this.normalizeProfileInput(rest as Partial<ModelProfileEntity>);
    const updated: ModelProfileEntity = {
      ...existing,
      ...normalized,
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
   *
   * P0：解析结果会把所属 provider 的端点/凭证/默认参数合并进来，
   * 因此下游（agent-loop / driver 构造）拿到的仍是自洽的扁平配置，无需感知分层。
   */
  async resolveEffectiveSettings(
    sessionProfileId?: string,
    requestOverride?: Partial<ModelProfileEntity>
  ): Promise<ModelProfileEntity> {
    let base: ModelProfileEntity | null = null;

    if (sessionProfileId) {
      const found = await this.getProfile(sessionProfileId);
      if (found) base = await this.hydrateProfile(found);
    }

    if (!base) {
      const def = await this.getDefaultProfile();
      if (def) base = await this.hydrateProfile(def);
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
