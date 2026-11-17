import { describe, it, expect } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { MockDriver } from "../src/adapters/mock-driver.js";

describe("Harness Server HTTP / SSE Gateway", () => {
  it("should respond to health check", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.registeredToolsCount).toBeGreaterThan(0);
  });

  it("should stream chat events via SSE", async () => {
    const mockDriver = new MockDriver();
    mockDriver.setScript({
      steps: [
        [
          {
            type: "text",
            text: "Hello from Harness!",
          },
        ],
      ],
    });

    const { app } = createHarnessServer({
      dbPath: ":memory:",
      modelDriver: mockDriver,
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Say hello",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("data: ");
    expect(text).toContain("text_delta");
    expect(text).toContain("turn_end");
    expect(text).toContain("data: [DONE]");
  });

  it("should accept action resolve via POST /api/action/:id", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });

    const promise = actionHub.waitForAction("action-abc", {
      toolName: "ui_approval_card",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/action-abc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved: true,
        note: "Approved by manager",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const actionResult = await promise;
    expect(actionResult.approved).toBe(true);
    expect(actionResult.note).toBe("Approved by manager");
  });
});

describe("模型连通性真探测（TASK-005）", () => {
  it("POST /api/settings/models/test 对不可达端点返回 ok:false 与真实错误", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/settings/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://127.0.0.1:9/v1",
        apiKey: "sk-test",
        model: "probe-model",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.endpoint).toBe("http://127.0.0.1:9/v1");
    expect(typeof json.latencyMs).toBe("number");
  });
});
