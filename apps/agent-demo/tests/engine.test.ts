import { describe, expect, it } from "vitest";
import { matchScenario } from "../src/engine/useAgentEngine";
import { FALLBACK_SCENARIO, SCENARIOS } from "../src/engine/scenarios";

describe("matchScenario 剧本路由", () => {
  it("关键词命中（大小写不敏感）", () => {
    expect(matchScenario("帮我生成周报").id).toBe("weekly-report");
    expect(matchScenario("重构用户列表页").id).toBe("refactor-users");
    expect(matchScenario("修复这个 bug").id).toBe("refactor-users");
    expect(matchScenario("分析一下任务数据").id).toBe("data-analysis");
    expect(matchScenario("Weekly REPORT").id).toBe("weekly-report");
  });

  it("多关键词优先级按声明顺序", () => {
    // 同时含「重构」与「分析」→ 声明序在前者（weekly-report 无命中，refactor 先于 analysis）
    expect(matchScenario("重构并分析").id).toBe("refactor-users");
  });

  it("未命中回落兜底剧本", () => {
    expect(matchScenario("你好")).toBe(FALLBACK_SCENARIO);
    expect(matchScenario("随便聊聊").id).toBe("fallback");
  });

  it("剧本事件合法性抽查", () => {
    for (const s of [...SCENARIOS, FALLBACK_SCENARIO]) {
      expect(s.events.length).toBeGreaterThan(0);
      // approval 门只出现在重构剧本
      if (s.id !== "refactor-users") {
        expect(s.events.some((e) => e.t === "approval")).toBe(false);
      }
    }
    const refactor = SCENARIOS.find((s) => s.id === "refactor-users")!;
    // 重构剧本必须覆盖：plan → approval → diff → terminal → checkpoint → summary
    const order = refactor.events.map((e) => e.t);
    for (const need of ["plan", "approval", "diff", "terminal", "checkpoint", "summary"]) {
      expect(order).toContain(need);
    }
    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("approval"));
    expect(order.indexOf("approval")).toBeLessThan(order.indexOf("diff"));
  });
});
