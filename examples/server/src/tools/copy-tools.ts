import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/** 口水词精简规则（仿真「冲击力」风格改写，保证 original/revised 有可见 diff） */
const POLISH_RULES: Array<[RegExp, string]> = [
  [/我们致力于/g, "我们"],
  [/非常|十分|极其|真的/g, ""],
  [/可以帮助您|能够帮助您|为您提供了/g, "给您"],
  [/进行了/g, ""],
  [/大家/g, "你"],
  [/的提升和改进/g, "的提升"],
  [/更好地/g, "更"],
];

/**
 * 场景④ 文案精修台：改写文案（只读）
 * 返回 ui_copy_polish 卡片（内嵌 VaInlineDiff 逐词采纳/拒绝）
 */
export const CopyPolishTool: HarnessTool = {
  name: "copy_polish",
  description: "按指定风格精修一段文案：去冗词、改主动句、前置关键数字，返回可逐词采纳的行内 diff（仿真改写引擎）",
  parameters: Type.Object({
    text: Type.String({ description: "待精修的原文案" }),
    style: Type.Optional(Type.String({ description: "目标风格，例如 冲击力、克制、口语化" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const original = String(ctx.args.text || "").trim();
    const style = String(ctx.args.style || "冲击力");
    let revised = original;
    for (const [re, to] of POLISH_RULES) revised = revised.replace(re, to);
    revised = revised.replace(/\s{2,}/g, " ").trim();
    if (revised === original) {
      revised = `${original}\n\n（已按「${style}」风格复核：句式已足够紧凑，仅建议将关键数字前置到首句。）`;
    }
    return {
      rendered: true,
      component: "ui_copy_polish",
      props: {
        original,
        revised,
        style,
        notes: [
          "删除冗余程度副词与「致力于」式套话，改用短句主动语态",
          "建议把转化率 +38% 这类关键数字前置到首句制造冲击",
          "可在 diff 中逐词决定采纳或保留原文",
        ],
      },
    };
  },
};

export const copyTools = [CopyPolishTool];
