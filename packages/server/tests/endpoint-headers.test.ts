/**
 * 域名规则 + 归属头（0.7.2）。
 *
 * 取舍：**不开放用户自定义请求头**，改为按 API 域名内置规则自动匹配——
 * 用户只填 baseUrl 与密钥，头由实现负责（规则外网关用 custom 预设）。
 * 覆盖：OpenCode 会话路由头、Azure api-key 接管鉴权、OpenRouter 来源头、
 * 非命中域名不注入、UA 默认与两种覆盖方式。
 */
import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENDPOINT_HEADER_RULES, attributionHeadersForRequest, resolveEndpointHeaders } from "../src/core/endpoint-headers.js";
import { PRODUCT_UA } from "../src/core/attribution.js";

/** 本包真实版本（UA 必须与它一致；0.7.1 曾静默发 0.0.0 而测试照样通过） */
const PKG_VERSION = (
  JSON.parse(
    fs.readFileSync(path.join(fileURLToPath(new URL("..", import.meta.url)), "package.json"), "utf8"),
  ) as { version: string }
).version;

const base = { protocol: "openai", apiKey: "sk-test", sessionId: "sess-1", model: "m" };

describe("resolveEndpointHeaders · 域名匹配", () => {
  it("OpenCode：opencode.ai 及其子域 → 注入会话头", () => {
    for (const baseUrl of ["https://opencode.ai/inference/openai/v1", "https://api.opencode.ai/v1"]) {
      const r = resolveEndpointHeaders({ ...base, baseUrl });
      expect(r.headers["x-opencode-session"]).toBe("sess-1");
      expect(r.ruleIds).toContain("opencode-session");
    }
  });

  it("OpenCode：没有 sessionId 时不注入（不发出空值头），记入 skipped", () => {
    const r = resolveEndpointHeaders({ ...base, sessionId: undefined, baseUrl: "https://opencode.ai/v1" });
    expect(r.headers["x-opencode-session"]).toBeUndefined();
    expect(r.ruleIds).not.toContain("opencode-session");
    expect(r.skippedRuleIds).toContain("opencode-session");
  });

  it("Azure：三种资源域名都命中，且 api-key 接管鉴权", () => {
    for (const host of ["r.openai.azure.com", "r.cognitiveservices.azure.com", "r.ai.azure.com"]) {
      const r = resolveEndpointHeaders({ ...base, baseUrl: `https://${host}/openai/v1` });
      expect(r.headers["api-key"]).toBe("sk-test");
      expect(r.ownsAuth).toBe(true);
    }
  });

  it("Azure：缺密钥时不注入（避免发出残缺请求），但记入 skipped 供 doctor 解释", () => {
    const r = resolveEndpointHeaders({ ...base, apiKey: undefined, baseUrl: "https://r.openai.azure.com/openai/v1" });
    expect(r.headers["api-key"]).toBeUndefined();
    expect(r.ownsAuth).toBe(false);
    expect(r.ruleIds).toEqual([]);
    expect(r.skippedRuleIds).toContain("azure-api-key");
  });

  it("OpenRouter：带上来源头（排行/限流按应用统计）", () => {
    const r = resolveEndpointHeaders({ ...base, baseUrl: "https://openrouter.ai/api/v1" });
    expect(r.headers["X-Title"]).toBe("vuagent");
    expect(r.headers["HTTP-Referer"]).toContain("vuagent");
  });

  it("普通端点（DeepSeek / 自建 / 别家域名）不注入任何规则头", () => {
    for (const baseUrl of [
      "https://api.deepseek.com/v1",
      "http://localhost:11434/v1",
      "https://my-gateway.internal.example.com/v1",
    ]) {
      const r = resolveEndpointHeaders({ ...base, baseUrl });
      expect(r.headers).toEqual({});
      expect(r.ruleIds).toEqual([]);
      expect(r.ownsAuth).toBe(false);
    }
  });

  it("相似但不同的域名不误命中（openrouter.ai 不能匹配 evil-openrouter.ai）", () => {
    const r = resolveEndpointHeaders({ ...base, baseUrl: "https://evil-openrouter.ai/v1" });
    expect(r.headers).toEqual({});
  });

  it("非法 baseUrl 不抛错（返回空结果）", () => {
    expect(resolveEndpointHeaders({ ...base, baseUrl: "not a url" }).headers).toEqual({});
  });

  it("规则表本身自洽：id 唯一、domains 非空且无通配", () => {
    const ids = ENDPOINT_HEADER_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of ENDPOINT_HEADER_RULES) {
      expect(rule.domains.length).toBeGreaterThan(0);
      for (const d of rule.domains) expect(d).not.toMatch(/[*]/);
    }
  });
});

describe("attributionHeadersForRequest · 归属头", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("默认发 vuagent/<真实版本> (+repo)：版本必须与 package.json 一致（C2 回归）", () => {
    delete process.env.VUAGENT_USER_AGENT;
    delete process.env.VUAGENT_USER_AGENT_SUFFIX;
    const ua = attributionHeadersForRequest()["user-agent"];
    expect(ua).toContain(`vuagent/${PKG_VERSION}`);
    expect(ua).toContain("github.com/HelloTomBruce/vuagent");
    expect(ua).toBe(PRODUCT_UA);
    expect(ua).not.toContain("0.0.0"); // 解析失败时的兜底值，测试必须能抓到
  });

  it("VUAGENT_USER_AGENT 整串覆盖（部分网关按 UA 白名单放行）", () => {
    const ua = attributionHeadersForRequest({ VUAGENT_USER_AGENT: "my-gateway/1.0" } as NodeJS.ProcessEnv);
    expect(ua["user-agent"]).toBe("my-gateway/1.0");
  });

  it("VUAGENT_USER_AGENT_SUFFIX 追加后缀", () => {
    const ua = attributionHeadersForRequest({ VUAGENT_USER_AGENT_SUFFIX: "acme" } as NodeJS.ProcessEnv);
    expect(ua["user-agent"]).toBe(`${PRODUCT_UA} acme`);
  });

  it("非法 UA 值（含换行/控制字符）回落默认并告警（R3）", () => {
    const ua = attributionHeadersForRequest({ VUAGENT_USER_AGENT: "bad\r\nInjected: 1" } as NodeJS.ProcessEnv);
    expect(ua["user-agent"]).toBe(PRODUCT_UA);
  });

  it("空字符串视为未设置（不会发出空 UA）", () => {
    const ua = attributionHeadersForRequest({ VUAGENT_USER_AGENT: "  ", VUAGENT_USER_AGENT_SUFFIX: " " } as NodeJS.ProcessEnv);
    expect(ua["user-agent"]).toBe(PRODUCT_UA);
  });
});
