/**
 * 同源回环放行（0.7.2 修复回归）：CLI 自托管 console 跑在 127.0.0.1:6880，
 * 浏览器写请求带 `Origin: http://127.0.0.1:6880`——旧白名单只有 dev 端口，
 * 于是「新建工作区/新建会话/发消息」全部 403（表现为：点新建工作区后弹手动输入）。
 *
 * 同时必须保住 DNS rebinding 防护：攻击者页面（evil.com 重绑到 127.0.0.1）
 * 的 Host 与 Origin 都是 evil.com，非回环 → 仍拒绝。
 */
import { describe, it, expect } from "vitest";
import { isSameOriginLoopback } from "../src/security.js";

describe("isSameOriginLoopback", () => {
  it("自托管端口（任意回环端口）同源 → 放行", () => {
    expect(isSameOriginLoopback("http://127.0.0.1:6880", "127.0.0.1:6880")).toBe(true);
    expect(isSameOriginLoopback("http://localhost:6880", "localhost:6880")).toBe(true);
    expect(isSameOriginLoopback("http://127.0.0.1:6996", "127.0.0.1:6996")).toBe(true);
  });

  it("端口不同 → 不放行（跨端口不是同源）", () => {
    expect(isSameOriginLoopback("http://127.0.0.1:3000", "127.0.0.1:6880")).toBe(false);
  });

  it("DNS rebinding：Host 与 Origin 同为非回环域名 → 拒绝", () => {
    expect(isSameOriginLoopback("http://evil.example.com:6880", "evil.example.com:6880")).toBe(false);
  });

  it("Origin 为非回环、Host 为回环 → 拒绝（跨站请求）", () => {
    expect(isSameOriginLoopback("http://evil.example.com", "127.0.0.1:6880")).toBe(false);
  });

  it("IPv6 回环同源 → 放行", () => {
    expect(isSameOriginLoopback("http://[::1]:6880", "[::1]:6880")).toBe(true);
  });

  it("缺 Origin / Host 或非法 Origin → 不放行（交给原有白名单/鉴权逻辑）", () => {
    expect(isSameOriginLoopback("", "127.0.0.1:6880")).toBe(false);
    expect(isSameOriginLoopback("http://127.0.0.1:6880", "")).toBe(false);
    expect(isSameOriginLoopback("not-a-url", "127.0.0.1:6880")).toBe(false);
  });

  it("末尾斜杠 / 大小写不敏感地匹配主机", () => {
    expect(isSameOriginLoopback("http://localhost:6880/", "localhost:6880")).toBe(true);
    expect(isSameOriginLoopback("http://LOCALHOST:6880", "localhost:6880")).toBe(true);
  });
});
