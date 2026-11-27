import { describe, expect, it } from "vitest";
import { useContextGauge } from "../composables/hooks/useContextGauge";
import type { ContextPart } from "@vuagent/ui";

const usageEvent = (fields: {
  promptTokens: number;
  completionTokens: number;
  contextWindow?: number;
  parts?: ContextPart[];
}) => fields;

const getActiveSessionId = () => "sess-active";

describe("useContextGauge（TASK-113）", () => {
  it("窗口口径覆盖（不累加）+ 计费口径逐事件累加", () => {
    const gauge = useContextGauge(getActiveSessionId);
    gauge.applyUsageEvent(usageEvent({ promptTokens: 1000, completionTokens: 100 }), "sess-active");
    gauge.applyUsageEvent(usageEvent({ promptTokens: 1200, completionTokens: 150 }), "sess-active");
    // 窗口口径：取最近一次（1200+150），非 1000+100 累加
    expect(gauge.contextUsed.value).toBe(1350);
    // 计费口径：跨步累加
    expect(gauge.sessionTokensUsed.value).toBe(1000 + 100 + 1200 + 150);
  });

  it("后台会话按 id 归账；活跃会话累计同步", () => {
    const gauge = useContextGauge(getActiveSessionId);
    gauge.applyUsageEvent(usageEvent({ promptTokens: 50, completionTokens: 50 }), "sess-background");
    // 后台会话：Map 记账生效
    expect(gauge.sessionTokensUsedMap.get("sess-background")).toBe(100);
    // 活跃会话累计不动（事件不属于当前会话）
    expect(gauge.sessionTokensUsed.value).toBe(0);
  });

  it("contextWindow 覆盖上限；parts 缺失降级单段历史", () => {
    const gauge = useContextGauge(getActiveSessionId);
    gauge.applyUsageEvent(usageEvent({ promptTokens: 10, completionTokens: 5, contextWindow: 200000 }), "sess-active");
    expect(gauge.contextLimit.value).toBe(200000);
    // 无 parts → 降级单段「对话历史」
    expect(gauge.ctxParts.value).toEqual([
      { id: "history", label: "对话历史", tokens: 15, kind: "history" },
    ]);

    const parts: ContextPart[] = [{ id: "system", label: "系统提示", tokens: 9, kind: "system" }];
    gauge.applyUsageEvent(usageEvent({ promptTokens: 1, completionTokens: 1, parts }), "sess-active");
    expect(gauge.ctxParts.value).toEqual(parts);
  });

  it("reset 归零仪表", () => {
    const gauge = useContextGauge(getActiveSessionId);
    const parts: ContextPart[] = [{ id: "system", label: "系统提示", tokens: 9, kind: "system" }];
    gauge.applyUsageEvent(usageEvent({ promptTokens: 100, completionTokens: 100, parts }), "sess-active");
    gauge.reset();
    expect(gauge.contextUsed.value).toBe(0);
    expect(gauge.sessionTokensUsed.value).toBe(0);
    expect(gauge.ctxParts.value).toEqual([]);
  });
});
