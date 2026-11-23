/** VaSessionTree SSR smoke：SSR 渲染平铺分组（工作区标题 + 全部会话，无树形折叠）。 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaSessionTree } from "../src";

const workspaces = [
  { id: "sample-app", name: "sample-app" },
  { id: "sample-api", name: "sample-api", description: "订单服务" },
];
const sessions = [
  { id: "s1", title: "调参实验", updatedAt: Date.now(), archived: false, workspaceId: "sample-app", running: true },
  { id: "s2", title: "", updatedAt: Date.now(), archived: false, workspaceId: "sample-app", pinned: true },
  { id: "s3", title: "折扣修复", updatedAt: Date.now(), archived: false, workspaceId: "sample-api", waitingApproval: true },
];
const archived = [{ id: "s4", title: "旧任务", updatedAt: Date.now(), archived: true, workspaceId: "sample-app" }];

describe("VaSessionTree SSR", () => {
  it("平铺分组：工作区标题 + 会话列表 + 归档计数，无折叠/无「内置」", async () => {
    const warn: string[] = [];
    const app = createSSRApp({
      render: () =>
        h(VaSessionTree, {
          workspaces,
          sessions,
          archived,
          currentWorkspaceId: "sample-app",
          currentSessionId: "s1",
        }),
    });
    app.config.warnHandler = (msg) => warn.push(msg);
    const html = await renderToString(app);
    expect(warn).toEqual([]);
    expect(html).toContain("sample-app");
    expect(html).toContain("sample-api");
    expect(html).toContain("调参实验");
    expect(html).toContain("未命名会话");
    expect(html).not.toContain("内置"); // 内置工作区已删除
    expect(html).toContain("当前");
    expect(html).toContain('data-current="true"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain("已归档（1）");
    expect(html).toContain("新建工作区");
    expect(html).not.toContain("折叠"); // 无树形折叠
  });

  it("newSession/searchable：主按钮与搜索框（G7/G9）", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaSessionTree, {
            workspaces: [{ id: "w", name: "w" }],
            sessions: [],
            archived: [],
            currentWorkspaceId: "w",
            currentSessionId: "",
            newSession: true,
            searchable: true,
          }),
      }),
    );
    expect(html).toContain("新建会话");
    expect(html).toContain("搜索会话");
    expect(html).not.toContain("待审批");
  });

  it("状态点与置顶（G8/G10）", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaSessionTree, {
            workspaces: [{ id: "w", name: "w" }],
            sessions: [
              { id: "a", title: "跑着", updatedAt: 1, archived: false, workspaceId: "w", running: true },
              { id: "b", title: "堵着", updatedAt: 2, archived: false, workspaceId: "w", waitingApproval: true },
              { id: "c", title: "钉住", updatedAt: 3, archived: false, workspaceId: "w", pinned: true },
            ],
            archived: [],
            currentWorkspaceId: "w",
            currentSessionId: "",
          }),
      }),
    );
    expect(html).toContain("va-stree__dot--run");
    expect(html).toContain("va-stree__dot--warn");
    expect(html).toContain("待审批");
    expect(html).toContain("va-stree__pin");
    expect(html).toContain("取消置顶");
  });

  it("孤儿会话提示；禁用态 disabled", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaSessionTree, {
            workspaces: [{ id: "w", name: "w" }],
            sessions: [{ id: "x", title: "孤儿", updatedAt: 1, archived: false, workspaceId: "gone" }],
            archived: [],
            currentWorkspaceId: "w",
            currentSessionId: "",
            disabled: true,
          }),
      }),
    );
    expect(html).toContain("未分组");
    expect(html).toContain("孤儿");
    expect(html).toContain("disabled");
  });
});

describe("VaSessionTree SSR · workspaceCreateMode=picker", () => {
  it("picker 模式：不渲染行内输入框，仍显示「新建工作区」", async () => {
    const warn: string[] = [];
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaSessionTree, {
            workspaces: [{ id: "w", name: "w" }],
            sessions: [],
            archived: [],
            currentWorkspaceId: "w",
            currentSessionId: "",
            workspaceCreateMode: "picker",
          }),
      }),
    );
    expect(warn).toEqual([]);
    expect(html).toContain("新建工作区");
    expect(html).not.toContain("va-stree__ws-create");
    expect(html).not.toContain("本地文件夹路径");
  });
});

describe("VaSessionTree SSR · collapsible + hoverOps", () => {
  const base = {
    workspaces: [{ id: "w", name: "w" }],
    sessions: [{ id: "s1", title: "跑任务", createdAt: 1, updatedAt: 1, archived: false, workspaceId: "w" }],
    archived: [],
    currentWorkspaceId: "w",
    currentSessionId: "s1",
  };

  it("collapsible：渲染折叠 chevron,默认展开;关闭时不渲染", async () => {
    const open = await renderToString(
      createSSRApp({ render: () => h(VaSessionTree, { ...base, collapsible: true }) }),
    );
    expect(open).toContain("va-stree__toggle");
    expect(open).toContain("收起 w 的会话"); // 默认展开 → aria 为收起
    expect(open).toContain("跑任务"); // 默认展开,会话可见

    const off = await renderToString(
      createSSRApp({ render: () => h(VaSessionTree, { ...base }) }),
    );
    expect(off).not.toContain("va-stree__toggle");
    expect(off).toContain("跑任务");
  });

  it("hoverOps：根节点带 data-hover-ops,操作按钮由 CSS 控制显隐", async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(VaSessionTree, { ...base, hoverOps: true }) }),
    );
    expect(html).toContain('data-hover-ops="true"');
    const plain = await renderToString(
      createSSRApp({ render: () => h(VaSessionTree, { ...base }) }),
    );
    expect(plain).not.toContain("data-hover-ops");
  });
});
