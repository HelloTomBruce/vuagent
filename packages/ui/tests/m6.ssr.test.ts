/**
 * M6 组件 SSR smoke 测试：renderToString 全量渲染（可渲染 + SSR 安全）。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "@vue/server-renderer";
import {
  VaChangeSummary,
  VaCombobox,
  VaDateRangePicker,
  VaFilterMenu,
  VaIntegrationPicker,
  VaIntegrationSettings,
  VaNotificationStack,
  VaOtpInput,
  VaProfileMenu,
  VaProgressTracker,
  VaPromptLibrary,
  VaReactionBar,
  VaSetupGuide,
  VaSmartRecommendation,
  VaStepperForm,
  VaTipsPanel,
} from "../src";

async function ssr(component: Component, props: Record<string, unknown> = {}) {
  const warn: string[] = [];
  const app = createSSRApp({ render: () => h(component, props) });
  app.config.warnHandler = (msg) => warn.push(msg);
  return { html: await renderToString(app), warn };
}

describe("M6 SSR 渲染", () => {
  it("VaCombobox：输入框 + 关闭态无下拉", async () => {
    const { html, warn } = await ssr(VaCombobox, {
      options: [
        { value: "a", label: "选项 A" },
        { value: "b", label: "选项 B" },
      ],
      modelValue: "a",
    });
    expect(warn).toEqual([]);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("va-cbx__list");
    expect(html).toContain("当前选中：选项 A");
  });

  it("VaFilterMenu：触发器计数徽章 + 关闭态", async () => {
    const { html } = await ssr(VaFilterMenu, {
      groups: [
        { id: "kind", label: "类型", options: [{ value: "bug", label: "缺陷" }] },
        { id: "env", label: "环境", type: "radio", options: [{ value: "prod", label: "生产" }] },
      ],
      modelValue: { kind: ["bug"], env: "prod" },
    });
    expect(html).toContain("2"); // 计数徽章
    expect(html).not.toContain("va-fm__panel");
  });

  it("VaOtpInput：受控值渲染到格子", async () => {
    const { html } = await ssr(VaOtpInput, { modelValue: "123", length: 6 });
    const cells = html.match(/class="va-otp__cell[^"]*"/g) ?? [];
    expect(cells).toHaveLength(6);
    expect(html).toContain('value="1"');
    expect((html.match(/va-otp__cell--filled/g) ?? []).length).toBe(3);
  });

  it("VaProfileMenu：首字母头像 + 未读徽标（关闭态无菜单）", async () => {
    const { html } = await ssr(VaProfileMenu, {
      name: "张北",
      email: "z@x.com",
      badge: 3,
      items: [{ id: "logout", label: "退出登录", danger: true }],
    });
    expect(html).toContain(">张</span>"); // 首字母色块
    expect(html).toContain('class="va-pm__badge"');
    expect(html).toContain('3');
    expect(html).not.toContain("退出登录"); // 菜单未开
  });

  it("VaProgressTracker：current 推断 + 完成态", async () => {
    const { html } = await ssr(VaProgressTracker, {
      steps: [{ label: "构建" }, { label: "测试" }, { label: "部署" }],
      current: 1,
    });
    expect(html).toContain('data-status="done"');
    expect(html).toContain('data-status="current"');
    expect(html).toContain('data-status="pending"');
  });

  it("VaStepperForm：具名插槽内容 + 步骤位置", async () => {
    const app = createSSRApp({
      render: () =>
        h(VaStepperForm, { steps: [{ id: "a", title: "账号" }, { id: "b", title: "偏好" }], step: 1 }, {
          "step-b": () => h("p", { id: "slot-b" }, "第二步内容"),
        }),
    });
    const html = await renderToString(app);
    expect(html).toContain("账号");
    expect(html).toContain("偏好");
    expect(html).toContain("第二步内容");
    expect(html).toContain("2 / 2");
  });

  it("VaSetupGuide：完成/跳过/进行中三态 + 进度", async () => {
    const { html } = await ssr(VaSetupGuide, {
      steps: [
        { id: "1", title: "装 CLI", status: "done" },
        { id: "2", title: "配 API Key", optional: true },
        { id: "3", title: "连仓库", status: "skipped" },
      ],
    });
    expect(html).toContain("2/3"); // done + skipped 已处理，1 项进行中
    expect(html).toContain("已完成");
    expect(html).toContain("已跳过");
    expect(html).toContain("跳过"); // optional 按钮
  });

  it("VaSmartRecommendation：收益标签 + 操作按钮", async () => {
    const { html } = await ssr(VaSmartRecommendation, {
      title: "开启上下文压缩",
      description: "长对话自动摘要，可减少 token 消耗。",
      impact: "预计省 30% tokens",
      actions: [
        { id: "apply", label: "现在开启", primary: true },
        { id: "later", label: "稍后" },
      ],
    });
    expect(html).toContain("预计省 30% tokens");
    expect(html).toContain("现在开启");
    expect(html).toContain("aria-label=\"忽略此建议\"");
  });

  it("VaPromptLibrary：搜索 + 分类 tab + 卡片", async () => {
    const { html } = await ssr(VaPromptLibrary, {
      prompts: [
        { id: "p1", title: "代码审查", body: "审查以下 diff…", category: "开发", tags: ["review"] },
        { id: "p2", title: "周报生成", body: "根据提交记录…", category: "效率" },
      ],
    });
    expect(html).toContain('type="search"');
    expect(html).toContain("开发");
    expect(html).toContain("周报生成");
    expect(html).toContain("#review");
  });

  it("VaDateRangePicker：触发摘要 + 关闭态", async () => {
    const { html } = await ssr(VaDateRangePicker, { start: 1731177600000, end: 1731264000000 });
    expect(html).toContain("→");
    expect(html).not.toContain("va-drp__panel");
  });

  it("VaIntegrationPicker：卡片网格 + 已连接态", async () => {
    const { html } = await ssr(VaIntegrationPicker, {
      items: [
        { id: "gh", name: "GitHub", description: "仓库与 PR", connected: true },
        { id: "slack", name: "Slack", description: "消息通知" },
      ],
    });
    expect(html).toContain("GitHub");
    expect(html).toContain("已连接");
    expect(html).toContain('aria-pressed="true"');
  });

  it("VaIntegrationSettings：开关 + 必填字段", async () => {
    const { html } = await ssr(VaIntegrationSettings, {
      name: "GitHub",
      description: "接入仓库",
      enabled: true,
      fields: [{ id: "token", label: "API Token", required: true, secret: true, placeholder: "ghp_…" }],
    });
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('type="password"');
    expect(html).toContain("保存");
  });

  it("VaNotificationStack：未读徽标 + 语义 icon + 相对时间", async () => {
    const { html } = await ssr(VaNotificationStack, {
      notifications: [
        { id: "n1", title: "构建失败", body: "vitest 1 个用例", kind: "danger", unread: true, createdAt: Date.now() - 120_000 },
        { id: "n2", title: "部署完成", kind: "success" },
      ],
    });
    expect(html).toContain("1");
    expect(html).toContain("未读");
    expect(html).toContain("构建失败");
    expect(html).toContain("2 分钟前");
    expect(html).toContain("全部已读");
  });

  it("VaTipsPanel：可关闭 tip", async () => {
    const { html } = await ssr(VaTipsPanel, {
      tips: [{ id: "t1", title: "试试 ⌘K", body: "随时唤起命令面板" }],
      dismissible: true,
    });
    expect(html).toContain("试试 ⌘K");
    expect(html).toContain("关闭技巧");
  });

  it("VaReactionBar：激活态 + 计数", async () => {
    const { html } = await ssr(VaReactionBar, {
      reactions: [
        { id: "up", emoji: "👍", label: "有帮助", count: 12, active: true },
        { id: "down", emoji: "👎", count: 1 },
      ],
    });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("12");
  });

  it("VaChangeSummary：合计统计 + 文件行 + 折叠", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `src/f${i}.ts`,
      status: "modified" as const,
      additions: i + 1,
      deletions: 1,
    }));
    const { html } = await ssr(VaChangeSummary, {
      files,
      duration: 84_000,
      toolCalls: 7,
      maxFiles: 2,
    });
    expect(html).toContain("5 个文件");
    expect(html).toContain("+15");
    expect(html).toContain("−5");
    expect(html).toContain("1m 24s"); // formatMs
    expect(html).toContain("7 次工具调用");
    expect(html).toContain("展开其余 3 个文件");
  });

  it("VaChangeSummary：空文件列表不炸", async () => {
    const { html } = await ssr(VaChangeSummary, { files: [] });
    expect(html).toContain("0 个文件");
  });
});
