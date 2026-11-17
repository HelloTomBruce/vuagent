/** VaSessionManager SSR smoke：SSR 只渲染触发按钮（面板 v-if="open" 客户端展开）。 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaSessionManager } from "../src";

const sessions = [
  { id: "s1", title: "调参实验", createdAt: Date.now(), updatedAt: Date.now(), archived: false },
  { id: "s2", title: "", createdAt: Date.now() - 90_000, updatedAt: Date.now() - 60_000, archived: true },
];

describe("VaSessionManager SSR", () => {
  it("渲染触发按钮，面板不在 SSR 输出", async () => {
    const warn: string[] = [];
    const app = createSSRApp({
      render: () => h(VaSessionManager, { sessions, activeId: "s1" }),
    });
    app.config.warnHandler = (msg) => warn.push(msg);
    const html = await renderToString(app);
    expect(warn).toEqual([]);
    expect(html).toContain('aria-label="会话管理"');
    expect(html).toContain("会话");
    expect(html).not.toContain("va-smn__panel");
    expect(html).not.toContain("调参实验");
  });

  it("禁用态输出 disabled 属性", async () => {
    const html = await renderToString(createSSRApp({ render: () => h(VaSessionManager, { sessions: [], activeId: "", disabled: true }) }));
    expect(html).toContain("disabled");
  });
});
