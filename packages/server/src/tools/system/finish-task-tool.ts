import { FinishTaskParamsSchema } from "@vuagent/protocol";
import type { HarnessTool } from "../../core/types.js";
import { FINISH_TASK_TOOL_NAME } from "../../core/finish-task.js";

/**
 * 显式终态声明工具（harness 控制面工具，无任何副作用）：
 * - execution.finishTaskMode=enforced 时由 agent-loop 在通用执行链之前拦截裁决
 *   （交付断言通过 → 显式完成；未通过 → 断言文案回喂模型继续产出），
 *   本 execute 仅在「off 模式下模型幻觉调用」时作为无害透传兜底；
 * - 低风险、免审批、不写工作区（纯声明语义）。
 */
export const FinishTaskTool: HarnessTool = {
  name: FINISH_TASK_TOOL_NAME,
  description:
    "宣告本轮任务完成。调用前必须已产出实质性内容（正文回复或工具产物）；" +
    "summary 概括做了什么与结果，deliverables 列出交付物清单。" +
    "若交付断言未通过，请继续完成任务后再次调用。",
  parameters: FinishTaskParamsSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const args = (ctx.args ?? {}) as { summary?: string; deliverables?: unknown };
    return {
      finished: true,
      summary: args.summary ?? "",
      deliverables: Array.isArray(args.deliverables) ? args.deliverables : [],
    };
  },
};
