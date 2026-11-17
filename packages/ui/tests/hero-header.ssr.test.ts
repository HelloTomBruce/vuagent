/** VaConversationHeader / VaEmptyHero SSR smoke。 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaConversationHeader, VaEmptyHero } from "../src";

describe("VaConversationHeader SSR", () => {
  it("标题 + 视图 tabs + 运行中徽标", async () => {
    const warn: string[] = [];
    const app = createSSRApp({
      render: () =>
        h(VaConversationHeader, {
          title: "修复登录超时",
          running: true,
          elapsedLabel: "00:42",
          views: [
            { id: "chat", label: "聊天" },
            { id: "trajectory", label: "轨迹" },
          ],
          activeView: "chat",
        }),
    });
    app.config.warnHandler = (msg) => warn.push(msg);
    const html = await renderToString(app);
    expect(warn).toEqual([]);
    expect(html).toContain("修复登录超时");
    expect(html).toContain("聊天");
    expect(html).toContain("轨迹");
    expect(html).toContain("运行中");
    expect(html).toContain("00:42");
    expect(html).toContain('data-active="true"');
    expect(html).toContain("重命名会话");
  });

  it("空标题显示未命名；待审批徽标优先于运行中", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaConversationHeader, { title: "", running: true, waitingApproval: true }),
      }),
    );
    expect(html).toContain("未命名会话");
    expect(html).toContain("待审批");
    expect(html).not.toContain("运行中");
  });
});

describe("VaEmptyHero SSR", () => {
  it("工作区卡 + 新建工作区虚线卡", async () => {
    const warn: string[] = [];
    const app = createSSRApp({
      render: () =>
        h(VaEmptyHero, {
          workspaces: [
            { id: "w1", name: "myproj", path: "~/code/myproj" },
            { id: "w2", name: "agent-html" },
          ],
        }),
    });
    app.config.warnHandler = (msg) => warn.push(msg);
    const html = await renderToString(app);
    expect(warn).toEqual([]);
    expect(html).toContain("开始一个任务");
    expect(html).toContain("myproj");
    expect(html).toContain("~/code/myproj");
    expect(html).toContain("新建工作区");
  });

  it("creating 禁用所有卡片", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaEmptyHero, { workspaces: [{ id: "w", name: "w" }], creating: true }),
      }),
    );
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
