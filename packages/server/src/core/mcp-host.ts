import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import type { HarnessTool } from "./types.js";

/** 错误消息截断（对齐 server.ts clipExternalError 的口径；本地实现避免引 server 模块） */
function clipError(msg: string, max = 500): string {
  const s = (msg || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s || "unknown error";
}

/**
 * McpHostService（0.9.0 W1，docs/design/v0.9-plan.md §2）：
 *
 * MCP server 连接管理 + 「MCP tool → HarnessTool」Adapter。设计取舍：
 * - **Adapter 不是平行体系**：转换后的工具 register 进现有 ToolRegistry，校验/
 *   超时/HITL/启停/台账全链路与内置工具同一执行路径——结构上不存在绕过沙箱的通道；
 * - 命名空间 `mcp__<server>__<tool>` 从根上杜绝与内置/其他 server 的重名冲突；
 * - 参数 schema 保留原始 JSON Schema（plain object，无 TypeBox Kind 符号）→
 *   registry.validateParams 走既有「无 Kind 放行」路径，校验交 MCP server 端执行
 *   （诚实放行优于假装校验）；sanitizeSchemaForModel 继续清洗 $ref 保模型网关兼容；
 * - trust: "confirm"（缺省，每次审批）| "trusted"（requiresApproval: false）——
 *   对齐仓库权限哲学：默认审批、显式信任；
 * - 生命周期：懒连接（首次 ensureConnected）→ 失败指数退避 → listChanged 增量
 *   register/remove（不重建 registry）→ shutdown 断连并回收 stdio 子进程。
 *   **stdio 子进程卫生是本模块的头号风险**：transport 持有 ChildProcess 引用，
 *   shutdown 逐个 close；doctor 报告连接状态。
 *
 * v0.9 范围：只做 tools（resources/prompts 不做）；只做 stdio transport（HTTP 留 0.10）。
 */

export interface McpServerConfig {
  /** 配置键（即 mcp.json 的 mcpServers 对象键名），用作命名空间 */
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** 缺省 confirm：每次调用走 HITL 审批 */
  trust?: "confirm" | "trusted";
  /** 调用超时（毫秒），缺省走 registry 的 60s 缺省（此处仅影响 per-call 传入） */
  timeoutMs?: number;
  enabled?: boolean;
}

/** mcp.json 文档形态（对齐 Claude Desktop / Cursor 的 mcpServers 惯例 + trust 扩展） */
export interface McpConfigFile {
  mcpServers: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string>; trust?: "confirm" | "trusted"; timeoutMs?: number; enabled?: boolean }
  >;
}

export interface McpServerStatus {
  name: string;
  /** connected / error / disabled / not-started */
  state: "connected" | "error" | "disabled" | "not-started";
  /** 连接成功时暴露的工具名（含命名空间前缀） */
  tools?: string[];
  error?: string;
}

export function loadMcpConfigFile(configPath: string): McpServerConfig[] {
  if (!fs.existsSync(configPath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(
      `mcp.json 解析失败（${configPath}）：${err instanceof Error ? err.message : String(err)}——修复该文件或暂时移走，服务跳过 MCP 初始化继续启动`
    );
  }
  const servers = (parsed as Partial<McpConfigFile> | null)?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers)
    .filter(([, v]) => v && typeof v === "object" && typeof (v as { command?: unknown }).command === "string")
    .map(([name, v]) => ({
      name,
      command: String((v as { command: string }).command),
      args: Array.isArray(v.args) ? v.args.map(String) : undefined,
      env: v.env && typeof v.env === "object" ? Object.fromEntries(Object.entries(v.env).map(([k, val]) => [k, String(val)])) : undefined,
      trust: v.trust === "trusted" ? ("trusted" as const) : ("confirm" as const),
      timeoutMs: typeof v.timeoutMs === "number" && v.timeoutMs > 0 ? v.timeoutMs : undefined,
      enabled: v.enabled !== false,
    }));
}

const MCP_TOOL_PREFIX = "mcp__";

/** 内部连接态 */
interface McpConnection {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  /** 上一次连接/刷新失败的错误（state=error 时有值） */
  error?: string;
}

export class McpHostService {
  private connections = new Map<string, McpConnection>();
  /** 已注入 registry 的命名空间工具名（remove 时用） */
  private registeredToolNames = new Set<string>();
  /** 串行化连接与注册（registry 单线程 Map，但并发 connect 会让注册交错） */
  private connecting: Promise<void> | null = null;
  private started = false;

  constructor(
    private opts: {
      configPath: string;
      register: (tool: HarnessTool) => void;
      unregister: (name: string) => void;
      clientName?: string;
      clientVersion?: string;
      /** 测试注入：替换 transport 工厂（InMemory transport 进 CI） */
      createTransport?: (config: McpServerConfig) => { start(): Promise<void>; close(): Promise<void> };
    }
  ) {}

  /** 配置里启用的 server 清单（含未连接的——doctor 展示） */
  configList(): McpServerConfig[] {
    return loadMcpConfigFile(this.opts.configPath);
  }

  /** doctor / API 用：各 server 连接状态 */
  status(): McpServerStatus[] {
    return this.configList().map((config) => {
      if (config.enabled === false) return { name: config.name, state: "disabled" as const };
      const conn = this.connections.get(config.name);
      if (!conn) return { name: config.name, state: "not-started" as const };
      if (conn.error) return { name: config.name, state: "error" as const, error: conn.error };
      const tools = [...this.registeredToolNames].filter((n) => n.startsWith(`${MCP_TOOL_PREFIX}${config.name}__`));
      return { name: config.name, state: "connected" as const, tools };
    });
  }

  /**
   * 懒启动：连接全部启用的 server 并注册工具。并发调用只连一次（串行化）；
   * 单个 server 失败不阻断其他 server（各自记录 error，工具隐藏）。
   */
  async ensureConnected(): Promise<void> {
    if (this.started) {
      // 已启动过：只补连失败/未起的（重试语义由调用方决定频率；此处幂等）
      return;
    }
    this.started = true;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const configs = this.configList().filter((c) => c.enabled !== false);
      await Promise.all(configs.map((c) => this.connectOne(c)));
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connectOne(config: McpServerConfig): Promise<void> {
    try {
      const transport = this.opts.createTransport
        ? this.opts.createTransport(config)
        : new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: { ...(process.env as Record<string, string>), ...(config.env || {}) },
            stderr: "pipe", // 不让 MCP server 的 stderr 污染宿主 stdout
          });
      const client = new Client({
        name: this.opts.clientName ?? "vuagent",
        version: this.opts.clientVersion ?? "0.0.0",
      });
      await client.connect(transport as never);
      const conn: McpConnection = { config, client, transport: transport as StdioClientTransport };
      this.connections.set(config.name, conn);

      client.onclose = () => {
        this.connections.delete(config.name);
        this.removeServerTools(config.name);
      };
      client.onerror = (err) => {
        conn.error = err instanceof Error ? err.message : String(err);
      };
      // listChanged：增量刷新该 server 的工具（不触碰其他 server 的注册）。
      // 必须传 SDK 的 Zod schema（新版 setNotificationHandler 会对入参做
      // method-literal 推断，纯对象会抛 "Schema is missing a method literal"）
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        void this.refreshServerTools(conn);
      });

      await this.refreshServerTools(conn);
    } catch (err) {
      // 单 server 失败不阻断其他 server；错误留 status 供 doctor/日志
      const existing = this.connections.get(config.name);
      if (existing) existing.error = clipError(err instanceof Error ? err.message : String(err));
      else
        this.connections.set(config.name, {
          config,
          error: clipError(err instanceof Error ? err.message : String(err)),
          // 占位连接（无 client/transport）——status 报 error
          client: null as unknown as Client,
          transport: null as unknown as StdioClientTransport,
        });
    }
  }

  /** 拉取该 server 的工具清单并增量注册/移除（连接成功与 listChanged 共用） */
  private async refreshServerTools(conn: McpConnection): Promise<void> {
    const { config, client } = conn;
    const { tools } = await client.listTools();
    const wanted = new Set<string>();
    for (const t of tools) {
      const namespaced = `${MCP_TOOL_PREFIX}${config.name}__${t.name}`;
      wanted.add(namespaced);
      if (this.registeredToolNames.has(namespaced)) continue;
      this.registeredToolNames.add(namespaced);
      this.opts.register(this.adaptTool(conn, t.name, t.description || "", t.inputSchema));
    }
    // server 侧已删除的工具：从 registry 移除
    for (const name of [...this.registeredToolNames]) {
      if (name.startsWith(`${MCP_TOOL_PREFIX}${config.name}__`) && !wanted.has(name)) {
        this.removeServerTool(name);
      }
    }
    conn.error = undefined;
  }

  private removeServerTools(serverName: string): void {
    for (const name of [...this.registeredToolNames]) {
      if (name.startsWith(`${MCP_TOOL_PREFIX}${serverName}__`)) this.removeServerTool(name);
    }
  }

  private removeServerTool(name: string): void {
    this.registeredToolNames.delete(name);
    this.opts.unregister(name);
  }

  /** MCP tool → HarnessTool（Adapter：进 registry 后与内置工具同链路） */
  private adaptTool(
    conn: McpConnection,
    originalName: string,
    description: string,
    inputSchema: unknown
  ): HarnessTool {
    const { config } = conn;
    const namespaced = `${MCP_TOOL_PREFIX}${config.name}__${originalName}`;
    const trusted = config.trust === "trusted";
    return {
      name: namespaced,
      description: `[MCP:${config.name}] ${description}`.trim(),
      // 原始 JSON Schema（plain object 无 Kind）→ validateParams 放行，校验在 MCP server 端
      parameters: (inputSchema ?? { type: "object", properties: {} }) as HarnessTool["parameters"],
      riskLevel: "medium",
      requiresApproval: !trusted,
      writesWorkspace: false, // 无法静态判断第三方工具副作用：写判定交 HITL 审批与 trust 档位
      execute: async (ctx) => {
        const timeoutMs = config.timeoutMs;
        const result = (await (timeoutMs
          ? Promise.race([
              conn.client.callTool({ name: originalName, arguments: ctx.args ?? {} }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`MCP 工具调用超时（${timeoutMs}ms）`)), timeoutMs)
              ),
            ])
          : conn.client.callTool({ name: originalName, arguments: ctx.args ?? {} }))) as {
          content?: Array<{ type: string; text?: string }>;
          isError?: boolean;
        };
        const text = (result.content || [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
        // MCP isError 语义转 registry 错误通道（throw → ToolExecutionResult.isError），
        // 正常返回只给文本净荷——isError:false / content 数组等传输层元数据不进模型上下文
        //（0.9.0 真机回归发现：裸返回会让模型看到 requestId/signal 之类的内部残留）
        if (result.isError === true) {
          throw new Error(clipError(text || "MCP 工具返回错误"));
        }
        return { text };
      },
    };
  }

  /** 优雅关停：断开全部连接（transport.close 回收 stdio 子进程） */
  async shutdown(): Promise<void> {
    const closes: Promise<void>[] = [];
    for (const [name, conn] of this.connections) {
      if (!conn.client || !conn.transport) continue;
      closes.push(
        conn.transport
          .close()
          .catch(() => {}) // 关停路径静默：子进程回收失败不阻断其余 server
          .finally(() => {
            this.connections.delete(name);
            void conn.client.close().catch(() => {});
          })
      );
    }
    await Promise.all(closes);
    this.removeServerToolsForAll();
  }

  private removeServerToolsForAll(): void {
    for (const name of [...this.registeredToolNames]) this.removeServerTool(name);
  }
}
