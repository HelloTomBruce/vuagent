/**
 * McpHostService（0.9.0 W1）测试：InMemory transport + 真 McpServer 进 CI（不依赖真子进程）。
 * 覆盖：配置解析 / 命名空间注册 / 调用代理 / trust 档位 / listChanged 增量 / 单 server 失败隔离 / shutdown 回收。
 */
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { McpHostService, loadMcpConfigFile } from "../src/core/mcp-host.js";
import type { McpServerConfig } from "../src/core/mcp-host.js";

/** InMemory client 端的形状（mcp-host 只要求 start/close） */
type FakeTransport = { start(): Promise<void>; close(): Promise<void> };

function writeConfig(servers: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  const file = path.join(dir, "mcp.json");
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }));
  return file;
}

/**
 * 造一个「可连接」的 mock MCP server：真 McpServer 挂在 InMemory pair 的 server 侧，
 * **await 完成 server.connect 后**返回 client 端——mcp-host 的 client.connect 晚于它。
 * ⚠️ 顺序敏感：InMemory 握手要求 server 侧先就绪，异步 then 会输给 initialize 握手。
 */
async function makeMockServer(tools: Array<{ name: string; description?: string }>): Promise<FakeTransport> {
  const server = new McpServer({ name: "mock", version: "1.0.0" });
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description }, async () => ({
      content: [{ type: "text" as const, text: `mock-result:${t.name}` }],
    }));
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport as Transport);
  return clientTransport as unknown as FakeTransport;
}

/** listChanged 用：动态 server（先建 pair 预连，测试中途增删工具 + 发通知）；返回 v1 句柄供下架 */
async function makeLiveServer() {
  const server = new McpServer({ name: "live", version: "1.0.0" });
  const v1Handle = server.registerTool("v1", {}, async () => ({ content: [{ type: "text", text: "1" }] }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport as Transport);
  return {
    clientTransport: clientTransport as unknown as FakeTransport,
    server,
    v1Handle,
  };
}

describe("loadMcpConfigFile", () => {
  it("文件不存在 → 空数组（MCP 不启用）", () => {
    expect(loadMcpConfigFile("/nonexistent/mcp.json")).toEqual([]);
  });

  it("坏 JSON → 抛出可读错误（doctor 报 error，服务跳过初始化）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-bad-"));
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, "{ not json");
    expect(() => loadMcpConfigFile(file)).toThrow(/mcp\.json 解析失败/);
  });

  it("trust 缺省 confirm；enabled:false 保留条目（doctor 展示禁用数）", () => {
    const file = writeConfig({
      a: { command: "echo", trust: "trusted" },
      b: { command: "echo", enabled: false },
    });
    const configs = loadMcpConfigFile(file);
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.name === "a")?.trust).toBe("trusted");
    expect(configs.find((c) => c.name === "b")?.enabled).toBe(false);
    expect(configs.find((c) => c.name === "b")?.trust).toBe("confirm"); // 缺省
  });
});

describe("McpHostService（InMemory transport）", () => {
  it("ensureConnected：工具以 mcp__<server>__<tool> 注册进 registry，调用代理返回文本", async () => {
    const registry = new ToolRegistry();
    const transport = await makeMockServer([{ name: "ping", description: "回个声" }]);
    const host = createHostWithInMemory(
      writeConfig({ demo: { command: "noop" } }),
      registry,
      () => transport
    );
    await host.ensureConnected();

    const tool = registry.get("mcp__demo__ping");
    expect(tool).toBeDefined();
    expect(tool?.requiresApproval).toBe(true); // trust 缺省 confirm
    expect(tool?.description).toContain("[MCP:demo]");

    const res = (await tool!.execute({ toolCallId: "t1", args: {} } as never)) as { text?: string };
    expect(res.text).toBe("mock-result:ping");

    const defs = registry.toModelToolDefinitions();
    expect(defs.some((d) => d.function.name === "mcp__demo__ping")).toBe(true);
    await host.shutdown();
  });

  it("trust: trusted → requiresApproval=false（显式信任免审批）", async () => {
    const registry = new ToolRegistry();
    const transport = await makeMockServer([{ name: "t" }]);
    const host = createHostWithInMemory(
      writeConfig({ srv: { command: "noop", trust: "trusted" } }),
      registry,
      () => transport
    );
    await host.ensureConnected();
    expect(registry.get("mcp__srv__t")?.requiresApproval).toBe(false);
    await host.shutdown();
  });

  it("listChanged：新增工具增量注册、删除工具增量下架（不重建 registry）", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "builtin_probe",
      description: "内置哨兵：增量刷新不得触碰",
      parameters: { type: "object", properties: {} },
      execute: async () => ({}),
    });
    const { clientTransport, server, v1Handle } = await makeLiveServer();
    // v1 的 RegisteredTool 句柄：remove() 下架后 sendToolListChanged 通知宿主刷新
    
    const host = new McpHostService({
      configPath: writeConfig({ live: { command: "noop" } }),
      register: (tool) => registry.register(tool),
      unregister: (name) => registry.remove(name),
      clientVersion: "test",
      createTransport: () => clientTransport,
    });
    await host.ensureConnected();
    expect(registry.get("mcp__live__v1")).toBeDefined();

    // server 侧变更：删 v1 加 v2 → 发 list_changed 通知
    v1Handle.remove();
    server.registerTool("v2", {}, async () => ({ content: [{ type: "text", text: "2" }] }));
    await server.sendToolListChanged();

    // 通知是异步处理：轮询等增量生效
    for (let i = 0; i < 30 && (!registry.get("mcp__live__v2") || registry.get("mcp__live__v1")); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(registry.get("mcp__live__v1")).toBeUndefined();
    expect(registry.get("mcp__live__v2")).toBeDefined();
    expect(registry.get("builtin_probe")).toBeDefined(); // 哨兵未受影响
    await host.shutdown();
  });

  it("单 server 失败不阻断其他 server（失败者状态 error，成功者正常注册）", async () => {
    const registry = new ToolRegistry();
    const goodTransport = await makeMockServer([{ name: "ok" }]);
    const host = new McpHostService({
      configPath: writeConfig({
        bad: { command: "noop" },
        good: { command: "noop" },
      }),
      register: (tool) => registry.register(tool),
      unregister: (name) => registry.remove(name),
      clientVersion: "test",
      createTransport: (config) => {
        if (config.name === "bad") {
          // 失败形态：start 即抛（模拟 MCP server 启动失败）
          return {
            start: async () => {
              throw new Error("spawn failed");
            },
            close: async () => {},
          };
        }
        return goodTransport;
      },
    });
    await host.ensureConnected();

    expect(registry.get("mcp__good__ok")).toBeDefined();
    expect(registry.get("mcp__bad__ok")).toBeUndefined();
    const st = host.status();
    expect(st.find((s) => s.name === "bad")?.state).toBe("error");
    expect(st.find((s) => s.name === "good")?.state).toBe("connected");
    await host.shutdown();
  });

  it("shutdown：注册的工具全部下架（stdio 子进程回收路径的注册面清理）", async () => {
    const registry = new ToolRegistry();
    const transport = await makeMockServer([{ name: "x" }]);
    const host = createHostWithInMemory(writeConfig({ s: { command: "noop" } }), registry, () => transport);
    await host.ensureConnected();
    expect(registry.get("mcp__s__x")).toBeDefined();
    await host.shutdown();
    expect(registry.get("mcp__s__x")).toBeUndefined();
    expect(registry.toModelToolDefinitions()).toHaveLength(0);
  });
});

function createHostWithInMemory(
  configPath: string,
  registry: ToolRegistry,
  transportFor: (config: McpServerConfig) => FakeTransport
): McpHostService {
  return new McpHostService({
    configPath,
    register: (tool) => registry.register(tool),
    unregister: (name) => registry.remove(name),
    clientVersion: "test",
    createTransport: transportFor,
  });
}
