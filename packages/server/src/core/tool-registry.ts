import { Value } from "@sinclair/typebox/value";
import { Kind } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import type { HarnessTool, ToolExecutionContext } from "./types.js";

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  isError: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * 递归净化 JSON Schema，保证兼容主流大模型（如 Moonshot / Kimi、OpenAI、Anthropic 等）参数校验规范：
 * 1. 消除未指向 '#/$defs/' 的非法 '$ref' 引用，避免 400 invalid_request_error
 * 2. 避免大模型端反序列化或递归编译失败
 */
export function sanitizeSchemaForModel(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const cloned = JSON.parse(JSON.stringify(schema));

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    // 如果存在非法 $ref（如未指向 #/$defs/ 的递归占位符），替换为通用对象避免模型网关拒绝
    if (typeof record.$ref === "string" && !record.$ref.startsWith("#/$defs/")) {
      delete record.$ref;
      if (!record.type) {
        record.type = "object";
      }
    }
    for (const key of Object.keys(record)) {
      walk(record[key]);
    }
  }

  walk(cloned);
  return cloned;
}

/**
 * 工具注册中心与沙箱执行器 (ToolRegistry)
 * 负责大模型 Function Calling 的元数据转换、入参校验、执行超时控制与异常隔离
 */
export class ToolRegistry {
  private tools = new Map<string, HarnessTool>();

  /**
   * 注册工具
   */
  register(tool: HarnessTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * 获取工具定义
   */
  get(name: string): HarnessTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 列出所有工具
   */
  list(): HarnessTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 转换为大模型标准 Function Calling 工具列表
   * @param disabledNames 被禁用的工具名集合（缺省全部暴露）；
   *      禁用语义 = 不进入模型可见的 definitions（调用侧由 agent-loop 仲裁兜底报错）
   * @param hideTools 引擎侧条件隐藏的工具名集合（如 finish_task 在 finishTaskMode=off 时）；
   *      与 disabledNames 同为可见性过滤，区别在于 hideTools 是配置推导而非用户启停配置，
   *      不进入 /api/tools 的启停语义
   */
  toModelToolDefinitions(options?: {
    disabledNames?: Set<string>;
    hideTools?: Set<string>;
  }): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    const disabled = options?.disabledNames;
    const hidden = options?.hideTools;
    return this.list()
      .filter((t) => !disabled || !disabled.has(t.name))
      .filter((t) => !hidden || !hidden.has(t.name))
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: sanitizeSchemaForModel(t.parameters),
        },
      }));
  }

  /**
   * 入参校验闸门（TASK-055 的 Kind+Value.Check 逻辑收口为公开方法，TASK-059）：
   * - agent-loop 工具执行段在 HITL 挂起判断前调用——非法入参不产生审批卡；
   * - execute 内部同调本方法，保持直接调用方的兜底拦截不变。
   * 仅对 TypeBox schema（带 Kind 符号）校验；schema 缺失/非 TypeBox 保持放行（向后兼容）。
   */
  validateParams(toolName: string, args: unknown): { ok: boolean; error?: string } {
    const tool = this.get(toolName);
    if (!tool) {
      return {
        ok: false,
        error: `Tool [${toolName}] is not registered in harness`,
      };
    }
    const schema = tool.parameters as TSchema;
    if (schema && typeof schema === "object" && typeof schema[Kind] === "string") {
      const candidate = args ?? {};
      // TASK-060 O2：Value.Check 快速通过——合法路径零迭代开销（此前每次全量
      // 迭代 Errors 收集后再判空）；失败时输出全部错误（去 slice(0,3) 截断）
      // 并追加「共 N 处」，引导模型一次性修完而非逐轮试探。
      if (!Value.Check(schema, candidate)) {
        const errors = [...Value.Errors(schema, candidate)];
        const detail = errors
          .map((e) => `${e.path || "/"} ${e.message}`)
          .join("; ");
        const countSuffix =
          errors.length > 1 ? `（共 ${errors.length} 处，请一次性全部修正）` : "";
        return {
          ok: false,
          error: `参数校验失败: ${detail}${countSuffix}。请修正入参后重试（勿编造工具不支持的参数）。`,
        };
      }
    }
    return { ok: true };
  }

  /**
   * 沙箱执行工具调用
   * 包含：超时保护、权限校验、异常捕获自愈
   */
  async execute(
    toolName: string,
    ctx: ToolExecutionContext,
    timeoutMs: number = 60_000
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const tool = this.get(toolName);

    if (!tool) {
      return {
        toolCallId: ctx.toolCallId,
        toolName,
        isError: true,
        error: `Tool [${toolName}] is not registered in harness`,
        durationMs: Date.now() - start,
      };
    }

    try {
      // TASK-055 参数校验硬闸门：模型幻觉出的非法入参在进入工具执行前拦截。
      // TASK-059：闸门逻辑收口至 validateParams，与 HITL 挂起前的前置校验共用同一文案。
      const validation = this.validateParams(toolName, ctx.args);
      if (!validation.ok) {
        return {
          toolCallId: ctx.toolCallId,
          toolName,
          isError: true,
          error: validation.error,
          durationMs: Date.now() - start,
        };
      }

      // 超时控制器
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        ctx.abortSignal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Tool execution aborted"));
        });
      });

      const execPromise = tool.execute(ctx);
      const res = await Promise.race([execPromise, timeoutPromise]);

      return {
        toolCallId: ctx.toolCallId,
        toolName,
        isError: false,
        result: res,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: ctx.toolCallId,
        toolName,
        isError: true,
        error: msg,
        durationMs: Date.now() - start,
      };
    }
  }
}
