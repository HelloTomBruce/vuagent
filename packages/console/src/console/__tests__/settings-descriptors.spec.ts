/**
 * 统一设置弹窗描述表单测（TASK-017 / TASK-020）
 * 覆盖：左导航 tab 描述表、交互设置项描述表与 InteractionSettings 字段的对齐关系、
 * 工具页风险徽标描述表（TOOL_RISK_META）的完备性与兜底行为
 */
import { describe, expect, it } from "vitest";
import { defaultInteractionSettings } from "../composables/useInteractionSettings";
import {
  INTERACTION_SETTING_ITEMS,
  SETTINGS_TABS,
  TOOL_RISK_META,
  toolRiskMetaOf,
} from "../components/settings/types";

describe("SETTINGS_TABS（设置弹窗左导航描述表）", () => {
  it("包含模型/交互/工具/执行/安全/提示词六个 tab，id 唯一且顺序稳定", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual([
      "models",
      "interaction",
      "tools",
      "execution",
      "security",
      "prompt",
    ]);
    expect(new Set(SETTINGS_TABS.map((t) => t.id)).size).toBe(SETTINGS_TABS.length);
  });

  it("配置中心三个 tab（execution/security/prompt）与服务端命名空间 id 同名（插槽分发约定）", () => {
    // SettingsModal 按 activeTab 分发同名插槽，ConfigPanel 按同 id 取命名空间——
    // 两端 id 同源是本文件要锁定的契约
    for (const id of ["execution", "security", "prompt"] as const) {
      expect(SETTINGS_TABS.some((t) => t.id === id)).toBe(true);
    }
  });

  it("每个 tab 都有标题与一句话说明", () => {
    for (const tab of SETTINGS_TABS) {
      expect(tab.title.trim()).not.toBe("");
      expect(tab.description.trim()).not.toBe("");
    }
  });

  it("「工具」tab 描述指向内置工具启停", () => {
    const toolsTab = SETTINGS_TABS.find((t) => t.id === "tools");
    expect(toolsTab?.title).toBe("工具");
  });
});

describe("INTERACTION_SETTING_ITEMS（交互设置项描述表）", () => {
  it("描述条目与 InteractionSettings 字段一一对应（不多不少）", () => {
    const itemKeys = INTERACTION_SETTING_ITEMS.map((i) => i.key).sort();
    const settingKeys = Object.keys(defaultInteractionSettings()).sort();
    expect(itemKeys).toEqual(settingKeys);
  });

  it("每个条目都有标题与一句话说明", () => {
    for (const item of INTERACTION_SETTING_ITEMS) {
      expect(item.title.trim()).not.toBe("");
      expect(item.description.trim()).not.toBe("");
    }
  });
});

describe("TOOL_RISK_META（工具页风险徽标描述表，TASK-020）", () => {
  it("覆盖 high/medium/low 全部风险等级，徽标文案与修饰类均非空且唯一", () => {
    expect(Object.keys(TOOL_RISK_META).sort()).toEqual(["high", "low", "medium"]);
    const classes = Object.values(TOOL_RISK_META).map((m) => m.className);
    expect(new Set(classes).size).toBe(classes.length);
    for (const meta of Object.values(TOOL_RISK_META)) {
      expect(meta.label.trim()).not.toBe("");
      expect(meta.className.trim()).not.toBe("");
    }
  });

  it("toolRiskMetaOf 按等级取行；未知/新增等级兜底中风险", () => {
    expect(toolRiskMetaOf("high")).toBe(TOOL_RISK_META.high);
    expect(toolRiskMetaOf("low")).toBe(TOOL_RISK_META.low);
    expect(toolRiskMetaOf("critical")).toBe(TOOL_RISK_META.medium);
    expect(toolRiskMetaOf("")).toBe(TOOL_RISK_META.medium);
  });
});
