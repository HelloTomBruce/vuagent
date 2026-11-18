/**
 * VaTrajectory 主从详情交互测试（DOM 环境真实挂载 + 点击）
 * 验证：splitDetail 模式下点击行 → 右侧详情卡片出现、行选中、无行内展开；
 * 再点同一行 / 点关闭 → 收起；传统模式维持行内展开、无详情卡片。
 */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VaTrajectory from "../src/components/trajectory/VaTrajectory.vue";
import type { TrajEvent } from "../src/components/trajectory/types";

const events: TrajEvent[] = [
  {
    id: "e1",
    at: Date.now(),
    lane: "input",
    role: "user",
    title: "帮我重构认证模块",
    turn: 1,
  },
  {
    id: "e2",
    at: Date.now() + 10,
    lane: "tool",
    role: "tool",
    title: "fs_read",
    detail: '{"filePath": "auth.ts"}',
    result: "export function login() {...}",
    turn: 1,
  },
];

describe("VaTrajectory splitDetail 主从模式", () => {
  it("点击台账行 → 右侧详情卡片出现且行选中，不发生行内展开", async () => {
    const wrapper = mount(VaTrajectory, {
      props: { events, splitDetail: true, bordered: false },
    });

    const rows = wrapper.findAll(".va-traj__row");
    expect(rows.length).toBe(2);
    expect(wrapper.find(".va-traj__detail").exists()).toBe(false);

    await rows[1].trigger("click");

    // 右侧详情卡片出现，内容对齐被点事件
    const detail = wrapper.find(".va-traj__detail");
    expect(detail.exists()).toBe(true);
    expect(detail.text()).toContain("fs_read");
    expect(detail.text()).toContain('{"filePath": "auth.ts"}');
    expect(detail.text()).toContain("export function login() {...}");
    // 行选中态，且绝不出现行内展开（data-open）
    expect(rows[1].attributes("data-selected")).toBe("true");
    expect(rows[1].attributes("data-open")).toBeUndefined();
    // 去卡片化 class 生效
    expect(wrapper.find(".va-traj--plain").exists()).toBe(true);
    expect(wrapper.find(".va-traj--split").exists()).toBe(true);
  });

  it("再点同一行 → 详情收起", async () => {
    const wrapper = mount(VaTrajectory, {
      props: { events, splitDetail: true },
    });
    const row = wrapper.findAll(".va-traj__row")[0];
    await row.trigger("click");
    expect(wrapper.find(".va-traj__detail").exists()).toBe(true);
    await row.trigger("click");
    expect(wrapper.find(".va-traj__detail").exists()).toBe(false);
  });

  it("点击详情卡片的关闭按钮 → 详情收起，并向宿主 emit select(null)", async () => {
    const wrapper = mount(VaTrajectory, {
      props: { events, splitDetail: true },
    });
    await wrapper.findAll(".va-traj__row")[0].trigger("click");
    await wrapper.find(".va-traj__detail-close").trigger("click");
    expect(wrapper.find(".va-traj__detail").exists()).toBe(false);
    const selectEvents = wrapper.emitted("select");
    expect(selectEvents?.at(-1)).toEqual([null]);
  });

  it("切换选中：点另一行 → 详情内容替换为该行事件", async () => {
    const wrapper = mount(VaTrajectory, {
      props: { events, splitDetail: true },
    });
    const rows = wrapper.findAll(".va-traj__row");
    await rows[1].trigger("click");
    await rows[0].trigger("click");
    const detail = wrapper.find(".va-traj__detail");
    expect(detail.exists()).toBe(true);
    expect(detail.text()).toContain("帮我重构认证模块");
    expect(detail.text()).toContain("该事件没有更多详情");
    expect(rows[0].attributes("data-selected")).toBe("true");
    expect(rows[1].attributes("data-selected")).toBeUndefined();
  });
});

describe("VaTrajectory 传统模式（无 splitDetail）", () => {
  it("点击行 → 行内展开（data-open），且不出现详情卡片", async () => {
    const wrapper = mount(VaTrajectory, { props: { events } });
    const rows = wrapper.findAll(".va-traj__row");
    await rows[1].trigger("click");
    expect(rows[1].attributes("data-open")).toBe("true");
    expect(wrapper.find(".va-traj__detail").exists()).toBe(false);
    expect(wrapper.emitted("toggle")?.[0]).toEqual(["e2", true]);
  });
});
