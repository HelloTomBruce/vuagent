/** VaTrajectory SSR smoke：指标条 + 三泳道 + 台账（角色彩签/第N轮/工具 args→result）。 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaTrajectory } from "../src";
import type { TrajEvent } from "../src";

const events: TrajEvent[] = [
  { id: "e1", at: T(0), lane: "input", role: "user", title: "修复登录超时", turn: 1 },
  { id: "e2", at: T(5), lane: "model", role: "assistant", title: "思考：分析连接池", turn: 1 },
  {
    id: "e3",
    at: T(10),
    endAt: T(80),
    lane: "tool",
    role: "tool",
    title: "edit_file",
    detail: '{"path":"a.ts"}',
    result: "已修改 a.ts",
    turn: 1,
  },
  { id: "e4", at: T(2000), lane: "input", role: "user", title: "跑测试", turn: 2 },
];

function T(ms: number) {
  return 1_700_000_000_000 + ms;
}

describe("VaTrajectory SSR", () => {
  it("指标条 + 三泳道块 + 台账（第N轮/角色签/工具 args→result）+ 空态", async () => {
    const warn: string[] = [];
    const html = await renderToString(createSSRApp({ render: () => h(VaTrajectory, { events }) }));
    void warn;
    expect(html).toContain("va-traj__bar");
    expect(html).toContain("轮次 2");
    expect(html).toContain("调用 1");
    expect(html).toContain("va-traj__lanes");
    expect(html).toContain("输入");
    expect(html).toContain("模型");
    expect(html).toContain("工具");
    expect(html).toContain('data-lane="tool"');
    expect(html).toContain("第1轮");
    expect(html).toContain("第2轮");
    expect(html).toContain('data-role="user"');
    expect(html).toContain('data-role="assistant"');
    expect(html).toContain('data-role="tool"');
    expect(html).toContain("edit_file");
    expect(html).toContain('&quot;path&quot;:&quot;a.ts&quot;'); // HTML 转义
    expect(html).toContain("已修改 a.ts");

    const empty = await renderToString(createSSRApp({ render: () => h(VaTrajectory, { events: [] }) }));
    expect(empty).toContain("还没有轨迹");
  });
});
