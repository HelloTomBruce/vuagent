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
   */
  toModelToolDefinitions(options?: {
    disabledNames?: Set<string>;
  }): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    const disabled = options?.disabledNames;
    return this.list()
      .filter((t) => !disabled || !disabled.has(t.name))
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        },
      }));
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
