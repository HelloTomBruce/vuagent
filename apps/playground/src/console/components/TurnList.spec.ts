/**
 * 用户消息附件回显（TASK-050）
 *
 * 三形态渲染约束：
 *   1. 当日真图（dataUrl 存在）→ 缩略图，外链可新窗口看原图
 *   2. 历史图片占位（只有元数据）→ 「[图] 名字」chip
 *   3. 文本附件 → 「[附件] 名字」chip
 * 无附件的用户消息渲染与现状一致（回归）。
 */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TurnList from "./TurnList.vue";
import type { MessageTurn } from "../types";

const DATA_URL = "data:image/png;base64,aVR0eE1n";

function mountTurns(turns: MessageTurn[]) {
  const wrapper = mount(TurnList, { props: { turns } });
  return wrapper;
}

describe("TurnList 附件回显", () => {
  it("当日真图：渲染缩略图，外链指向 dataUrl", () => {
    const wrapper = mountTurns([
      {
        id: "t1",
        role: "user",
        content: "看看这张",
        timestamp: 1,
        attachments: [{ name: "pixel.png", kind: "image", size: 67, dataUrl: DATA_URL }],
      },
    ]);
    const img = wrapper.find(".va-console__user-att-img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe(DATA_URL);
    expect(wrapper.find(".va-console__user-att-img-link").attributes("href")).toBe(DATA_URL);
    // 真图形态不渲染占位 chip
    expect(wrapper.find(".va-console__user-att-chip").exists()).toBe(false);
    wrapper.unmount();
  });

  it("历史占位：只有元数据的图片显示「[图] 名字」chip，不渲染 img", () => {
    const wrapper = mountTurns([
      {
        id: "t2",
        role: "user",
        content: "昨天的图",
        timestamp: 1,
        attachments: [{ name: "old.png", kind: "image", size: 1024 }],
      },
    ]);
    const chip = wrapper.find(".va-console__user-att-chip");
    expect(chip.text()).toBe("[图] old.png");
    expect(wrapper.find(".va-console__user-att-img").exists()).toBe(false);
    wrapper.unmount();
  });

  it("文本附件：「[附件] 名字」chip；多附件混合渲染", () => {
    const wrapper = mountTurns([
      {
        id: "t3",
        role: "user",
        content: "混合附件",
        timestamp: 1,
        attachments: [
          { name: "a.ts", kind: "file", size: 300 },
          { name: "b.png", kind: "image", size: 67, dataUrl: DATA_URL },
        ],
      },
    ]);
    const chips = wrapper.findAll(".va-console__user-att-chip").map((c) => c.text());
    expect(chips).toEqual(["[附件] a.ts"]);
    expect(wrapper.findAll(".va-console__user-att-img")).toHaveLength(1);
    wrapper.unmount();
  });

  it("无附件消息渲染与现状一致（无附件节点）", () => {
    const wrapper = mountTurns([{ id: "t4", role: "user", content: "纯文本", timestamp: 1 }]);
    expect(wrapper.find(".va-console__user-atts").exists()).toBe(false);
    expect(wrapper.find(".va-console__user-text").text()).toBe("纯文本");
    wrapper.unmount();
  });
});
