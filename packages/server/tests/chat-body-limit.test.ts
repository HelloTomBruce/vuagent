/**
 * TASK-084：/api/chat 请求体硬上限（hono bodyLimit，解析前拦截）
 *
 * 视觉通道让多 MB base64 载荷常态化（4 张 ×5MB 解码 ≈ base64 26.7MB），
 * 32MB 上限兼容满载图片请求，同时挡住无界 body 全量进内存的 DoS 面。
 */
import { describe, it, expect } from "vitest";
import { createHarnessServer } from "../src/server.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

describe("/api/chat body 上限（TASK-084）", () => {
  it("超 32MB 请求体 → 413 + JSON 错误（解析前拦截）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    // 33MB：超过 32MB 上限（content-length 快路径即拦截，无需真的全量读入）
    const huge = JSON.stringify({ prompt: "x".repeat(33 * 1024 * 1024) });
    const res = await app.request("/api/chat", { method: "POST", headers: H, body: huge });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
    expect(json.error).toContain("32MB");
  });

  it("上限之下正常到达路由（缺 prompt 仍走业务 400，而非 413）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ prompt: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("prompt");
  });

  it("其他 POST 路由不受 chat 上限影响（中间件按路径挂载）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    // 工作区创建是另一个 POST 路由，正常小请求不受任何影响
    const res = await app.request("/api/workspaces", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "W", rootPath: "/tmp", permission: "read-write" }),
    });
    expect([200, 201]).toContain(res.status);
  });
});
