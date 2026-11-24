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
 * 场景④ 文案精修台：生成多风格变体（只读）
 * 返回 ui_copy_variants 卡片——点选任一变体回传 prompt，进入按该风格的精修（多轮链入口）。
 */
export const CopyVariantsTool: HarnessTool = {
  name: "copy_variants",
  description: "为一段文案生成三种风格变体（冲击力 / 克制 / 口语化），返回可点选的变体对比卡。用户点选后可继续调用 copy_polish 按该风格精修。",
  parameters: Type.Object({
    text: Type.String({ description: "原文案" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const original = String(ctx.args.text || "").trim();
    return {
      rendered: true,
      component: "ui_copy_variants",
      props: {
        original,
        variants: [
          {
            style: "冲击力",
            angle: "数字前置 + 短句主动语态",
            text: "客服响应快 38%，接入只要 10 分钟。全渠道一个后台搞定——这就是新一代智能客服平台。",
          },
          {
            style: "克制",
            angle: "事实陈述 + 去形容词",
            text: "智能客服平台：支持网页、App、微信等渠道接入，平均响应耗时下降 38%，单后台统一管理会话与工单。",
          },
          {
            style: "口语化",
            angle: "对话感 + 场景开头",
            text: "客户在等，别让 TA 转圈。接个客服系统像点外卖一样快：10 分钟上线，网页、微信、App 一个后台全管了，响应速度还快了 38%。",
          },
        ],
      },
    };
  },
};

/**
 * 场景④ 文案精修台：按风格精修（只读，行内 diff）
 */
export const CopyPolishTool: HarnessTool = {
  name: "copy_polish",
  description: "按指定风格精修一段文案：去冗词、改主动句、前置关键数字，返回可逐词采纳的行内 diff 与改写说明（仿真改写引擎）",
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
          "建议把「响应快 38%」「10 分钟接入」这类关键数字前置到首句制造冲击",
          "可在 diff 中逐词决定采纳或保留原文；也可以先调用 copy_variants 生成三种风格变体再挑一个精修",
        ],
        predicted: { ctrDelta: "+12%~+18%", readability: "句均 14 字（原 23 字）" },
      },
    };
  },
};

export const copyTools = [CopyVariantsTool, CopyPolishTool];
