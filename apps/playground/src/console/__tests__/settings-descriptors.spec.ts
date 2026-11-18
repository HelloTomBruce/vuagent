/**
 * 统一设置弹窗描述表单测（TASK-017）
 * 覆盖：左导航 tab 描述表、交互设置项描述表与 InteractionSettings 字段的对齐关系
 */
import { describe, expect, it } from "vitest";
import { defaultInteractionSettings } from "../composables/useInteractionSettings";
import {
  INTERACTION_SETTING_ITEMS,
  SETTINGS_TABS,
} from "../components/settings/types";

describe("SETTINGS_TABS（设置弹窗左导航描述表）", () => {
  it("包含「模型与 API」与「交互」两个 tab，id 唯一且顺序稳定", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["models", "interaction"]);
  });

  it("每个 tab 都有标题与一句话说明", () => {
    for (const tab of SETTINGS_TABS) {
      expect(tab.title.trim()).not.toBe("");
      expect(tab.description.trim()).not.toBe("");
    }
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
