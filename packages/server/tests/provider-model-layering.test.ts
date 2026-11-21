/**
 * P0 模型设置重构：Provider / Model 分层
 *
 * 覆盖：
 *   1. 存量单层配置 → 按凭证归组迁移成 1 provider + N model
 *   2. provider 凭证变更对其下所有模型立即生效（1:N 的核心语义）
 *   3. 删除供应商的守卫与级联
 *   4. apiKey 脱敏在 provider 层同样成立
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { sanitizeProvider } from "../src/security.js";

describe("Provider / Model 分层（P0）", () => {
  let driver: MemoryStorageDriver;
  let settingsRepo: SettingsRepository;

  beforeEach(() => {
    driver = new MemoryStorageDriver();
    settingsRepo = new SettingsRepository(driver);
  });

  it("存量配置按 (provider, baseUrl, apiKey) 归组成 1:N", async () => {
    // 模拟旧结构：同一 DeepSeek 端点下三条重复配置，各自带相同的 baseUrl+apiKey
    const shared = { provider: "deepseek" as const, baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-shared-key-1234" };
    await settingsRepo.createProfile({ ...shared, id: "m-chat", name: "DeepSeek Chat", model: "deepseek-chat", isDefault: true });
    await settingsRepo.createProfile({ ...shared, id: "m-reasoner", name: "DeepSeek R1", model: "deepseek-reasoner" });
    await settingsRepo.createProfile({ ...shared, id: "m-coder", name: "DeepSeek Coder", model: "deepseek-coder" });

    const providers = await settingsRepo.providers.listProviders();
    const models = await settingsRepo.listProfiles();

    // 三条重复配置应收敛为一个 provider
    expect(providers).toHaveLength(1);
    expect(providers[0].provider).toBe("deepseek");
    expect(providers[0].apiKey).toBe("sk-shared-key-1234");

    // 三个模型都挂到该 provider 下
    expect(models).toHaveLength(3);
    expect(models.every((m) => m.providerId === providers[0].id)).toBe(true);
  });

  it("凭证不同的配置不会被错误合并", async () => {
    await settingsRepo.createProfile({
      id: "a", name: "A", provider: "custom", model: "m1",
      baseUrl: "https://a.example.com/v1", apiKey: "sk-aaa", isDefault: true,
    });
    await settingsRepo.createProfile({
      id: "b", name: "B", provider: "custom", model: "m2",
      baseUrl: "https://b.example.com/v1", apiKey: "sk-bbb",
    });

    const providers = await settingsRepo.providers.listProviders();
    expect(providers).toHaveLength(2);
    const models = await settingsRepo.listProfiles();
    expect(new Set(models.map((m) => m.providerId)).size).toBe(2);
  });

  it("改供应商凭证后，其下所有模型立即生效（provider 值优先）", async () => {
    const shared = { provider: "openai" as const, baseUrl: "https://api.old.com/v1", apiKey: "sk-old-key-0001" };
    await settingsRepo.createProfile({ ...shared, id: "m1", name: "M1", model: "gpt-4o", isDefault: true });
    await settingsRepo.createProfile({ ...shared, id: "m2", name: "M2", model: "gpt-4o-mini" });

    const [provider] = await settingsRepo.providers.listProviders();
    await settingsRepo.providers.updateProvider(provider.id, {
      baseUrl: "https://api.new.com/v1",
      apiKey: "sk-new-key-9999",
    });

    const m1 = await settingsRepo.resolveEffectiveSettings("m1");
    const m2 = await settingsRepo.resolveEffectiveSettings("m2");

    // 两个模型都拿到新端点与新密钥，不会被模型上的迁移残留挡住
    for (const resolved of [m1, m2]) {
      expect(resolved.baseUrl).toBe("https://api.new.com/v1");
      expect(resolved.apiKey).toBe("sk-new-key-9999");
    }
  });

  it("provider 参数作为默认值被模型覆盖", async () => {
    const provider = await settingsRepo.providers.createProvider({
      name: "Custom", provider: "custom",
      baseUrl: "https://x.example.com/v1", apiKey: "sk-x-1234",
      parameters: { temperature: 0.9, maxTokens: 4096 },
    });
    await settingsRepo.createProfile({
      id: "m1", name: "M1", provider: "custom", model: "m",
      providerId: provider.id, parameters: { temperature: 0.1 }, isDefault: true,
    });

    const resolved = await settingsRepo.resolveEffectiveSettings("m1");
    expect(resolved.parameters?.temperature).toBe(0.1); // 模型覆盖
    expect(resolved.parameters?.maxTokens).toBe(4096);  // 继承 provider
  });

  it("仍挂着模型的供应商默认拒绝删除，cascade 时才级联", async () => {
    const provider = await settingsRepo.providers.createProvider({
      name: "P", provider: "custom", baseUrl: "https://p.example.com/v1", apiKey: "sk-p-1234",
    });
    await settingsRepo.createProfile({ id: "m1", name: "M1", provider: "custom", model: "m", providerId: provider.id });

    const blocked = await settingsRepo.providers.deleteProvider(provider.id);
    expect(blocked.deleted).toBe(false);
    expect(blocked.reason).toBe("provider_has_models");
    expect(blocked.boundModels).toBe(1);

    const forced = await settingsRepo.providers.deleteProvider(provider.id, { cascade: true });
    expect(forced.deleted).toBe(true);
    expect(forced.removedModels).toBe(1);
    expect(await settingsRepo.getProfile("m1")).toBeNull();
  });

  it("provider 回显只给 apiKey 掩码", async () => {
    const provider = await settingsRepo.providers.createProvider({
      name: "P", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-very-secret-abcd",
    });
    const sanitized = sanitizeProvider(provider);
    expect(Object.hasOwn(sanitized, "apiKey")).toBe(false);
    expect(sanitized.maskedApiKey).toBeDefined();
    expect(sanitized.maskedApiKey).toContain("abcd");
    expect(JSON.stringify(sanitized)).not.toContain("sk-very-secret-abcd");
  });

  it("迁移幂等：重复读取不会产生重复 provider", async () => {
    await settingsRepo.createProfile({
      id: "m1", name: "M1", provider: "qwen", model: "qwen-max",
      baseUrl: "https://dashscope.aliyuncs.com/v1", apiKey: "sk-q-1234", isDefault: true,
    });

    await settingsRepo.providers.listProviders();
    await settingsRepo.providers.listProviders();
    await settingsRepo.providers.listProviders();

    expect(await settingsRepo.providers.listProviders()).toHaveLength(1);
  });

  it("一个 provider 下可挂多个模型（核心诉求）", async () => {
    const provider = await settingsRepo.providers.createProvider({
      name: "DeepSeek 官方", provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-ds-1234",
    });

    for (const [id, model] of [["m1", "deepseek-chat"], ["m2", "deepseek-reasoner"], ["m3", "deepseek-coder"]] as const) {
      await settingsRepo.createProfile({ id, name: model, provider: "deepseek", model, providerId: provider.id });
    }

    const bound = await settingsRepo.providers.listModelsOf(provider.id);
    expect(bound).toHaveLength(3);
    // 三个模型共享同一份凭证，模型记录自身不再持有密钥
    expect(bound.every((m) => !m.apiKey)).toBe(true);
  });

  it("默认 profile 只播种一次：删光后不再复活（浏览器回归发现的回归）", async () => {
    // 全新库首次读取 → 播种 4 条默认配置
    const seeded = await settingsRepo.listProfiles();
    expect(seeded.length).toBe(4);
    expect(seeded.every((m) => m.id)).toBe(true);

    // 用户删光（P0 语义：零模型合法）
    for (const m of seeded) {
      await settingsRepo.deleteProfile(m.id);
    }

    // 再次读取：不得重新播种——否则迁移会让 4 个默认供应商不断复活
    const after = await settingsRepo.listProfiles();
    expect(after).toEqual([]);
  });

  it("存量库（曾有配置）首次读到非空表后，删空同样不复活", async () => {
    await settingsRepo.createProfile({
      id: "m1", name: "M1", provider: "custom", model: "m", isDefault: true,
      baseUrl: "https://x.example.com/v1", apiKey: "sk-x-1234",
    });
    // 首次 listProfiles 读到非空表 → 补播种标记
    await settingsRepo.listProfiles();

    await settingsRepo.deleteProfile("m1");
    expect(await settingsRepo.listProfiles()).toEqual([]);
  });
});
