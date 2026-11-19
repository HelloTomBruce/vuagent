/**
 * VaSessionTree confirmMode / footer 插槽测试（happy-dom 真实挂载）：
 * - confirmMode 默认（inline）：首次点删除只进入行内确认态（data-danger + 「确认?」），二次点击才发事件
 * - confirmMode="none"：首次点击即发 remove / removeWorkspace（宿主路由 vaConfirm），不出现确认态
 * - footer 插槽：渲染宿主注入内容
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import VaSessionTree from "../src/components/session-tree/VaSessionTree.vue";
import type { SessionTreeProps, TreeSession, TreeWorkspace } from "../src/components/session-tree/types";

const WS: TreeWorkspace[] = [{ id: "ws1", name: "工作区一" }];
const SESS: TreeSession[] = [
  { id: "s1", title: "会话甲", createdAt: 1, updatedAt: 2, archived: false, workspaceId: "ws1" },
];
const ARCHIVED: TreeSession[] = [
  { id: "s2", title: "归档乙", createdAt: 3, updatedAt: 4, archived: true, workspaceId: "ws1" },
];

function mountTree(props: Partial<SessionTreeProps> = {}, footer?: string) {
  return mount(VaSessionTree, {
    props: {
      workspaces: WS,
      sessions: SESS,
      archived: ARCHIVED,
      currentWorkspaceId: "ws1",
      currentSessionId: "",
      ...props,
    },
    slots: footer ? { footer: footer } : {},
  });
}

const settle = async () => {
  await nextTick();
  await nextTick();
};

const delSessionBtn = (w: VueWrapper) => w.findAll("button").find((b) => b.attributes("aria-label") === "删除")!;
const delWsBtn = (w: VueWrapper) => w.findAll("button").find((b) => b.attributes("aria-label") === "删除工作区")!;

/** 登记挂载的 wrapper，用例结束统一 unmount */
const mounted: VueWrapper[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("VaSessionTree confirmMode", () => {
  it("默认 inline：首次点击只进入行内确认态，二次点击才发 remove", async () => {
    const w = mountTree();
    mounted.push(w);
    await delSessionBtn(w).trigger("click");
    await settle();
    expect(w.emitted("remove")).toBeUndefined();
    // 确认态下 aria-label 变为「确认删除」，改按 data-danger 定位同一颗按钮
    const dangerBtn = w.findAll("button").find((b) => b.attributes("data-danger") !== undefined);
    expect(dangerBtn).toBeTruthy();
    expect(dangerBtn!.text()).toContain("确认?");

    await dangerBtn!.trigger("click");
    await settle();
    expect(w.emitted("remove")).toEqual([["s1"]]);
  });

  it('confirmMode="none"：首次点击即发 remove / removeWorkspace，无确认态', async () => {
    const w = mountTree({ confirmMode: "none" });
    mounted.push(w);

    await delSessionBtn(w).trigger("click");
    await settle();
    expect(w.emitted("remove")).toEqual([["s1"]]);
    expect(delSessionBtn(w).attributes("data-danger")).toBeUndefined();

    await delWsBtn(w).trigger("click");
    await settle();
    expect(w.emitted("removeWorkspace")).toEqual([["ws1"]]);
  });

  it("footer 插槽渲染宿主注入内容", () => {
    const w = mountTree({}, "<button class='foot-btn'>设置</button>");
    mounted.push(w);
    const foot = w.find(".va-stree__footer");
    expect(foot.exists()).toBe(true);
    expect(foot.find(".foot-btn").text()).toBe("设置");
  });

  it("不传 footer 插槽时不渲染 footer 容器", () => {
    const w = mountTree();
    mounted.push(w);
    expect(w.find(".va-stree__footer").exists()).toBe(false);
  });
});
