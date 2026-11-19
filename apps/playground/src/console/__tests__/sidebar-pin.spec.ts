// @vitest-environment happy-dom
/**
 * 侧栏置顶回归测试：VaSessionTree 的置顶按钮必须发 toggle-pin 事件（Bug 回归守卫），
 * 且宿主排序把 pinned 会话浮到各分组最前（组件只保留宿主数组顺序）。
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ConsoleSidebar from "../components/ConsoleSidebar.vue";
import type { SessionItem, WorkspaceItem } from "../types";

// happy-dom 环境按文件注解启用（vitest.config 默认 node）
// @vitest-environment happy-dom

const workspaces: WorkspaceItem[] = [
  { id: "ws-1", name: "demo", rootPath: "/tmp/demo", permission: "read-write", createdAt: 1, updatedAt: 1 },
];

function session(partial: Partial<SessionItem>): SessionItem {
  return {
    id: "s-x",
    workspaceId: "ws-1",
    title: "未命名",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function mountSidebar(sessions: SessionItem[]) {
  return mount(ConsoleSidebar, {
    props: {
      workspaces,
      sessions,
      activeWorkspaceId: "ws-1",
      activeSessionId: "",
      isNewChat: false,
      sessionRunningMap: new Map(),
    },
  });
}

describe("ConsoleSidebar · 置顶", () => {
  it("点击置顶按钮 → 发 toggle-pin 事件并携带会话 id", async () => {
    const wrapper = mountSidebar([session({ id: "s-1", title: "甲" })]);
    const pinButton = wrapper.find('button[aria-label="置顶"]');
    expect(pinButton.exists()).toBe(true);
    await pinButton.trigger("click");
    expect(wrapper.emitted("toggle-pin")).toEqual([["s-1"]]);
  });

  it("已置顶会话行渲染取消置顶按钮，点击发同一事件", async () => {
    const wrapper = mountSidebar([session({ id: "s-2", pinned: true, title: "乙" })]);
    const unpinButton = wrapper.find('button[aria-label="取消置顶"]');
    expect(unpinButton.exists()).toBe(true);
    await unpinButton.trigger("click");
    expect(wrapper.emitted("toggle-pin")).toEqual([["s-2"]]);
  });

  it("置顶会话浮到分组最前，未置顶保持原相对顺序（稳定排序）", () => {
    const wrapper = mountSidebar([
      session({ id: "a", title: "A", updatedAt: 3 }),
      session({ id: "b", title: "B", pinned: true, updatedAt: 1 }),
      session({ id: "c", title: "C", updatedAt: 2 }),
    ]);
    const titles = wrapper.findAll(".va-stree__session-title").map((n) => n.text());
    expect(titles).toEqual(["B", "A", "C"]);
  });
});
