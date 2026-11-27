/**
 * 内置供应商预设表的一致性（0.7.2）：这是全仓唯一事实源，
 * 服务端默认端点/协议路由与前端下拉都从它派生——它自相矛盾就会全线错。
 */
import { describe, it, expect } from "vitest";
import {
  PROVIDER_PRESETS,
  PROVIDER_PRESETS_IDS,
  PROVIDER_PRESET_BY_ID,
  providerPreset,
} from "../src/providers.js";
import { PROVIDER_KINDS, isProviderKind } from "../src/models.js";

describe("PROVIDER_PRESETS", () => {
  it("id 唯一，且 PROVIDER_KINDS 与之完全一致", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...PROVIDER_KINDS].sort()).toEqual([...ids].sort());
    expect(PROVIDER_PRESETS_IDS).toHaveLength(ids.length);
  });

  it("每条预设字段合法：label 非空、baseUrl 可解析、协议与鉴权形态在枚举内", () => {
    const protocols = new Set(["openai", "anthropic", "azure", "gemini", "native"]);
    const authStyles = new Set(["bearer", "x-api-key", "api-key", "none"]);
    for (const p of PROVIDER_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(() => new URL(p.baseUrl)).not.toThrow();
      expect(protocols.has(p.protocol)).toBe(true);
      expect(authStyles.has(p.authStyle)).toBe(true);
      if (p.contextWindow !== undefined) expect(p.contextWindow).toBeGreaterThan(0);
    }
  });

  it("协议与鉴权形态自洽：anthropic→x-api-key，azure→api-key，本地→none", () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.protocol === "anthropic") expect(p.authStyle).toBe("x-api-key");
      if (p.protocol === "azure") expect(p.authStyle).toBe("api-key");
      if (p.domain === "localhost") expect(p.authStyle).toBe("none");
    }
  });

  it("每个域名至多归属一条预设（域名规则据此匹配，重复会导致判定歧义）", () => {
    const seen = new Map<string, string>();
    for (const p of PROVIDER_PRESETS) {
      if (!p.domain) continue;
      if (p.domain === "localhost") continue; // 本地多个端口共用
      const prev = seen.get(p.domain);
      expect(prev ?? p.id).toBe(p.id);
      seen.set(p.domain, p.id);
    }
  });

  it("国内常用供应商都在 featured 里（默认下拉第一屏可用）", () => {
    const featured = new Set<string>(PROVIDER_PRESETS.filter((p) => p.featured).map((p) => p.id));
    for (const id of ["deepseek", "qwen", "zhipu", "moonshot", "openai", "anthropic", "siliconflow"]) {
      expect(featured.has(id)).toBe(true);
    }
  });

  it("providerPreset 对未知 id 回落 custom（旧库里的历史 id 不能炸）", () => {
    expect(providerPreset("not-a-provider").id).toBe("custom");
    expect(isProviderKind("not-a-provider")).toBe(false);
    expect(PROVIDER_PRESET_BY_ID.deepseek?.baseUrl).toContain("api.deepseek.com");
  });

  it("id 元组的每个成员都有对应预设（R1：元组与表互为约束）", () => {
    for (const id of PROVIDER_PRESETS_IDS) {
      const preset = PROVIDER_PRESET_BY_ID[id];
      expect(preset, `缺少预设：${id}`).toBeDefined();
    }
  });

  it("至少覆盖 20 家（内置清单不能只有 5-6 家）", () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(20);
  });
});
