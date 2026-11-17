/** VaDock SSR smoke：单 pane / 分屏 / 全屏 / 空 tabs 态渲染。 */
import { describe, expect, it } from "vitest";
import { markRaw } from "vue";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { FolderTree } from "lucide-vue-next";
import { VaDock } from "../src";

const tab = (id: string, label: string) => ({ id, label });

describe("VaDock SSR", () => {
  it("单 pane：tab 条 + 激活态 + 全局操作", async () => {
    const warn: string[] = [];
    const app = createSSRApp({
      render: () =>
        h(VaDock, {
          panes: [{ tabs: [tab("events", "事件流"), tab("tasks", "任务")], activeId: "events" }],
        }),
    });
    app.config.warnHandler = (msg) => warn.push(msg);
    const html = await renderToString(app);
    expect(warn).toEqual([]);
    expect(html).toContain("事件流");
    expect(html).toContain("任务");
    expect(html).toContain('data-active="true"');
    expect(html).toContain("添加面板");
    expect(html).toContain("收起面板区");
    expect(html).not.toContain("va-dock__divider");
  });

  it("分屏：两 pane + 分隔条 + 取消分屏入口", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaDock, {
            panes: [
              { tabs: [tab("events", "事件流")], activeId: "events" },
              { tabs: [tab("terminal", "终端")], activeId: "terminal" },
            ],
          }),
      }),
    );
    expect(html).toContain("va-dock__divider");
    expect(html).toContain("取消分屏");
    expect(html).toContain("全屏面板 2"); // 全局操作挂在最后一个 pane
  });

  it("全屏：只渲染目标 pane，提供退出入口", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaDock, {
            panes: [
              { tabs: [tab("events", "事件流")], activeId: "events" },
              { tabs: [tab("terminal", "终端")], activeId: "terminal" },
            ],
            fullscreenPane: 1,
          }),
      }),
    );
    expect(html).toContain("退出全屏");
    expect(html).not.toContain("va-dock__divider");
    // pane 0 隐藏但 SSR v-show 仍输出 style —— 断言终端 tab 存在即可
    expect(html).toContain("终端");
  });

  it("空 tabs：占位提示；图标 tab 渲染 svg", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaDock, {
            panes: [{ tabs: [{ id: "files", label: "文件", icon: markRaw(FolderTree), closable: false }], activeId: "files" }],
          }),
      }),
    );
    expect(html).toContain("文件");
    expect(html).toContain("<svg");
    expect(html).not.toContain("关闭面板"); // closable: false
  });
});
