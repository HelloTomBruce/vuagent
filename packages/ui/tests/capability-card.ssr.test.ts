/** VaCapabilityCard SSR smoke：可渲染 + 无警告 + 结构断言。 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaCapabilityCard } from "../src";

describe("VaCapabilityCard SSR", () => {
  it("渲染徽标/标题/描述/清单/提示", async () => {
    const warn: string[] = [];
    const app = createSSRApp({
      render: () =>
        h(VaCapabilityCard, {
          level: 2,
          name: "计划与审批",
          description: "能写会问：写操作前必须过人工审批门。",
          events: ["plan.set", "approval.request"],
          components: ["VaAgentPlan", "VaApprovalCard"],
          hint: "试试：让 agent 修复一个文件",
          dismissible: true,
        }),
    });
    app.config.warnHandler = (msg) => warn.push(msg);
    const html = await renderToString(app);
    expect(warn).toEqual([]);
    expect(html).toContain("L2");
    expect(html).toContain("计划与审批 已启用");
    expect(html).toContain("审批门");
    expect(html).toContain("plan.set");
    expect(html).toContain("VaApprovalCard");
    expect(html).toContain("试试：让 agent 修复一个文件");
    expect(html).toContain("关闭说明");
  });

  it("无清单时不渲染网格；title 覆盖默认标题", async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(VaCapabilityCard, { level: 0, name: "纯对话", title: "自定义标题" }) }),
    );
    expect(html).toContain("自定义标题");
    expect(html).not.toContain("va-cap__grid");
  });
});
