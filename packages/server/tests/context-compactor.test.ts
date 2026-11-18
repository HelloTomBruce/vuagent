import { describe, expect, it } from "vitest";
import { COMPACT_SUMMARY_MARKER, ContextCompactor, type ChatMessage } from "../src/core/context-compactor.js";

/** 校验消息序列满足供应商严格校验(GLM 1214)的配对/非空约束 */
function assertValidPairing(messages: ChatMessage[]) {
  const declared = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) declared.add(tc.id);
    }
    if (m.role === "tool") {
      expect(declared.has(m.tool_call_id!), `孤儿 tool 消息 ${m.tool_call_id}`).toBe(true);
    }
    if (m.role !== "assistant" || !m.tool_calls?.length) {
      // 有 tool_calls 的 assistant 允许无 content；其余角色 content 不得为空串
      expect(m.content === undefined || m.content.length > 0 || m.role === "assistant", `空 content: ${m.role}`).toBe(true);
    }
  }
}

describe("ContextCompactor.sanitize", () => {
  it("丢弃孤儿 tool 消息(前置 assistant.tool_calls 被裁掉)", () => {
    const compactor = new ContextCompactor();
    const out = compactor.sanitize([
      { role: "user", content: "hi" },
      { role: "assistant", content: "好的" },
      { role: "tool", tool_call_id: "call-1", name: "read_file", content: "file content" },
    ]);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    assertValidPairing(out);
  });

  it("剥离无响应的 tool_calls;剥空且无正文时整条移除", () => {
    const compactor = new ContextCompactor();
    const out = compactor.sanitize([
      { role: "user", content: "hi" },
      { role: "assistant", tool_calls: [{ id: "call-x", type: "function", function: { name: "run_command", arguments: "{}" } }] },
      { role: "user", content: "继续" },
    ]);
    expect(out.every((m) => !(m as any).tool_calls?.length)).toBe(true);
    assertValidPairing(out);
  });

  it("保留配对完整的 assistant.tool_calls + tool", () => {
    const compactor = new ContextCompactor();
    const out = compactor.sanitize([
      { role: "user", content: "读文件" },
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"filePath":"a"}' } }] },
      { role: "tool", tool_call_id: "c1", name: "read_file", content: "content" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[1].tool_calls).toHaveLength(1);
    assertValidPairing(out);
  });

  it("空 content 填占位符", () => {
    const compactor = new ContextCompactor();
    const out = compactor.sanitize([
      { role: "user", content: "" },
      { role: "assistant", content: "" },
      { role: "tool", tool_call_id: "", name: "x", content: "" },
    ]);
    // 空 tool_call_id 的 tool 是孤儿被丢弃;user 被占位;空 assistant 无 calls 被移除
    expect(out.some((m) => m.role === "user" && m.content === "(empty)")).toBe(true);
    expect(out.some((m) => m.role === "assistant")).toBe(false);
    expect(out.some((m) => m.role === "tool")).toBe(false);
  });
});

describe("ContextCompactor.patchUnansweredToolCalls", () => {
  it("为最后一条 assistant.tool_calls 缺失的响应补占位 tool 消息", () => {
    const compactor = new ContextCompactor();
    const messages: ChatMessage[] = [
      { role: "user", content: "任务" },
      { role: "assistant", tool_calls: [
        { id: "c1", type: "function", function: { name: "a", arguments: "{}" } },
        { id: "c2", type: "function", function: { name: "b", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "c1", name: "a", content: "ok" },
    ];
    compactor.patchUnansweredToolCalls(messages);
    const patched = messages.find((m) => m.role === "tool" && m.tool_call_id === "c2");
    expect(patched?.content).toContain("执行中止");
    assertValidPairing(messages);
  });

  it("全部已响应时不追加任何消息", () => {
    const compactor = new ContextCompactor();
    const messages: ChatMessage[] = [
      { role: "user", content: "任务" },
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "a", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", name: "a", content: "ok" },
    ];
    const before = messages.length;
    compactor.patchUnansweredToolCalls(messages);
    expect(messages.length).toBe(before);
  });
});

describe("ContextCompactor.compact 轮次块裁剪", () => {
  it("超限时按块整删,绝不拆散 tool_calls ↔ tool 配对", () => {
    // maxToolChars 大,token 阈值小 → 触发裁剪
    const compactor = new ContextCompactor({ maxContextTokens: 500, maxToolResultChars: 100000, preserveRecentTurns: 1 });
    const longText = "x".repeat(600);
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: longText }, // 块1(user)
      { role: "assistant", tool_calls: [{ id: "b1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "b1", name: "f", content: longText },
      { role: "assistant", content: longText },
      { role: "user", content: longText }, // 块2(user)
      { role: "assistant", tool_calls: [{ id: "b2", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "b2", name: "f", content: longText },
      { role: "assistant", content: "完成" },
    ];
    const out = compactor.compact(messages);
    assertValidPairing(out);
    // 块1 的配对消息要么同在要么同失
    const hasB1Call = out.some((m) => m.role === "assistant" && m.tool_calls?.some((tc) => tc.id === "b1"));
    const hasB1Tool = out.some((m) => m.role === "tool" && m.tool_call_id === "b1");
    expect(hasB1Call).toBe(hasB1Tool);
  });

  it("短历史不触发裁剪,原样透传(仅 sanitize)", () => {
    const compactor = new ContextCompactor();
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    expect(compactor.compact(messages)).toEqual(messages);
  });
});

describe("ContextCompactor.estimateParts 分段估算", () => {  it("带工具调用的对话返回 system/history/tools 三段,各段之和 == estimateTokens", () => {
    const compactor = new ContextCompactor();
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful agent." },
      { role: "user", content: "读取配置文件" },
      { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"filePath":"a.json"}' } }] },
      { role: "tool", tool_call_id: "c1", name: "read_file", content: '{"key":"value"}' },
      { role: "assistant", content: "读取完成" },
    ];
    const parts = compactor.estimateParts(messages);
    expect(parts.map((p) => p.id)).toEqual(["system", "history", "tools"]);
    expect(parts.map((p) => p.kind)).toEqual(["system", "history", "tools"]);
    expect(parts.map((p) => p.label)).toEqual(["系统提示", "对话历史", "工具结果"]);
    // 逐条计数分段聚合：各段之和 = 总量 − 2(对话边界开销只在 estimateTokens 侧计)
    const sum = parts.reduce((t, p) => t + p.tokens, 0);
    const total = compactor.estimateTokens(messages);
    expect(sum + 2).toBe(total);
  });

  it("tools 段只统计 role:tool 的结果,history 段不包含工具结果", () => {
    const compactor = new ContextCompactor();
    const toolMsg: ChatMessage = { role: "tool", tool_call_id: "c1", name: "read_file", content: "file content here" };
    const historyMsgs: ChatMessage[] = [
      { role: "user", content: "读文件" },
      { role: "assistant", content: "ok" },
    ];
    const parts = compactor.estimateParts([...historyMsgs, toolMsg]);
    // 分段值为逐条消息计数(不含对话边界 +2),即 estimateTokens([msg]) - 2
    expect(parts.find((p) => p.kind === "tools")!.tokens).toBe(compactor.estimateTokens([toolMsg]) - 2);
    expect(parts.find((p) => p.kind === "history")!.tokens).toBe(compactor.estimateTokens(historyMsgs) - 2);
  });

  it("纯对话(无工具调用)只返回 system + history 两段", () => {
    const compactor = new ContextCompactor();
    const parts = compactor.estimateParts([
      { role: "system", content: "sys prompt" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！有什么可以帮你？" },
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0].kind).toBe("system");
    expect(parts[1].kind).toBe("history");
  });

  it("assistant.tool_calls 调用声明计入 history 段而非 tools 段", () => {
    const compactor = new ContextCompactor();
    const callMsg: ChatMessage = {
      role: "assistant",
      tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: '{"x":1}' } }],
    };
    const parts = compactor.estimateParts([callMsg, { role: "tool", tool_call_id: "c1", name: "f", content: "r" }]);
    expect(parts.find((p) => p.kind === "history")!.tokens).toBe(compactor.estimateTokens([callMsg]) - 2);
  });

  it("空消息列表返回空数组(零分段省略)", () => {
    expect(new ContextCompactor().estimateParts([])).toEqual([]);
  });
});

describe("ContextCompactor.manualCompact 手动压缩 (TASK-008)", () => {
  /** 构造 N 轮对话快照：system + 每轮 [user 提问, assistant 回答]，正文足够长以验证摘要裁剪 */
  function buildTurns(count: number): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: "system", content: "sys prompt" }];
    for (let i = 1; i <= count; i++) {
      messages.push({ role: "user", content: `提问 ${i}：请帮我处理任务 ${i}，${"背景说明".repeat(60)}` });
      messages.push({ role: "assistant", content: `已完成任务 ${i} 的处理与回复。${"补充说明".repeat(60)}` });
    }
    return messages;
  }

  it("折叠早期轮次为摘要占位,保留 system 与最近原始对话(keepTokens 预算)", () => {
    const compactor = new ContextCompactor();
    // 每块 333 tokens；keepTokens=800 → 尾部圈定 2 块(666≤800),第 3 块累计 999>800 停
    // → 保留尾 2 块(轮 5/6),折叠 4 块
    const out = compactor.manualCompact(buildTurns(6), { keepTokens: 800 });
    expect(out.foldedTurnCount).toBe(4);
    expect(out.totalCompactedTurns).toBe(4);

    const messages = out.messages;
    // system 保留在首位
    expect(messages[0].role).toBe("system");
    // 摘要占位消息紧跟 system,以固定标记开头
    expect(messages[1].role).toBe("user");
    expect(messages[1].content!.startsWith(COMPACT_SUMMARY_MARKER)).toBe(true);
    // 摘要含被折叠轮次的要点(行裁剪在 120 字符内,提问序号保留)
    expect(messages[1].content).toContain("提问 1");
    expect(messages[1].content).toContain("提问 4");
    // 保留区: 提问 5/6 完整保留
    const joined = messages.map((m) => m.content || "").join("\n");
    expect(joined).toContain("提问 5");
    expect(joined).toContain("提问 6");
    // 被折叠轮次的完整原文不再出现在摘要里(摘要行仅保留前 120 字符;
    // 未折叠轮次正文完整保留,故只对摘要消息断言)
    expect(messages[1].content).not.toContain("补充说明".repeat(60));
    // 保留区 token 预算约束:压缩后保留区(摘要+最近轮次)总量受控
    expect(compactor.estimateTokens(messages)).toBeLessThan(compactor.estimateTokens(buildTurns(6)));
  });

  it("压缩后 token 显著回落且 tool_calls↔tool 配对合法", () => {
    const compactor = new ContextCompactor();
    const messages: ChatMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 1; i <= 5; i++) {
      messages.push({ role: "user", content: `任务 ${i}` });
      messages.push({
        role: "assistant",
        tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: `{"p":${i}}` } }],
      });
      messages.push({ role: "tool", tool_call_id: `c${i}`, name: "read_file", content: `result-${"x".repeat(300)}` });
      messages.push({ role: "assistant", content: `任务 ${i} 完成` });
    }
    const before = compactor.estimateTokens(messages);
    const out = compactor.manualCompact(messages, { keepTokens: 300 });
    const after = compactor.estimateTokens(out.messages);
    expect(out.foldedTurnCount).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    assertValidPairing(out.messages);
    // 最近 1 轮的配对完整保留
    expect(out.messages.some((m) => m.role === "tool" && m.tool_call_id === "c5")).toBe(true);
  });

  it("可折叠空间不足时 foldedCount=0 原样返回", () => {
    const compactor = new ContextCompactor();
    const messages = buildTurns(2);
    const out = compactor.manualCompact(messages, { keepTokens: 100_000 });
    expect(out.foldedTurnCount).toBe(0);
    expect(out.totalCompactedTurns).toBe(0);
    expect(out.messages).toEqual(compactor.sanitize(messages));
    expect(out.summary).toBe("");
  });

  it("二次压缩:旧摘要块被再折叠并继承要点,累计轮次数正确衔接", () => {
    const compactor = new ContextCompactor();
    // 第一次:6 轮折 4 轮,保留 2 轮
    const first = compactor.manualCompact(buildTurns(6), { keepTokens: 800 });
    expect(first.totalCompactedTurns).toBe(4);

    // 再补 2 轮新对话(模拟后续 turn 追加),共 4 块(1 摘要 + 3 真实轮次)
    const followUp = [...first.messages];
    followUp.push({ role: "user", content: "提问 7：继续任务 7" });
    followUp.push({ role: "assistant", content: "任务 7 完成" });
    followUp.push({ role: "user", content: "提问 8：继续任务 8" });
    followUp.push({ role: "assistant", content: "任务 8 完成" });

    // 第二次:keepTokens=500 → 尾部保留 2 轮(短轮次),摘要块被再折叠
    const second = compactor.manualCompact(followUp, {
      keepTokens: 500,
      previousCompactedTurns: first.totalCompactedTurns,
    });
    expect(second.foldedTurnCount).toBeGreaterThanOrEqual(1); // 摘要占位不算真实轮次
    expect(second.totalCompactedTurns).toBeGreaterThan(4);
    // 旧摘要要点与新折叠轮次要点合并
    expect(second.summary).toContain("提问 1");
    // 最近轮次完整保留
    const joined = second.messages.map((m) => m.content || "").join("\n");
    expect(joined).toContain("提问 8");
    assertValidPairing(second.messages);
  });

  it("压缩产出的摘要块以固定标记起始,二次压缩可识别", () => {
    const compactor = new ContextCompactor();
    const out = compactor.manualCompact(buildTurns(5), { keepTokens: 800 });
    const summaryMsg = out.messages.find((m) => m.content?.startsWith(COMPACT_SUMMARY_MARKER));
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg?.role).toBe("user");
  });

  it("保留区边界不拆散 tool_calls↔tool 配对", () => {
    const compactor = new ContextCompactor();
    const messages: ChatMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 1; i <= 4; i++) {
      messages.push({ role: "user", content: `u${i} ${"q".repeat(500)}` });
      messages.push({
        role: "assistant",
        tool_calls: [{ id: `k${i}`, type: "function", function: { name: "f", arguments: "{}" } }],
      });
      messages.push({ role: "tool", tool_call_id: `k${i}`, name: "f", content: "r".repeat(500) });
    }
    const out = compactor.manualCompact(messages, { keepTokens: 700 });
    assertValidPairing(out.messages);
    // 每个保留的 tool 响应必有配对声明,反之亦然
    const declared = new Set<string>();
    for (const m of out.messages) {
      if (m.role === "assistant" && m.tool_calls) for (const tc of m.tool_calls) declared.add(tc.id);
    }
    for (const m of out.messages) {
      if (m.role === "tool") expect(declared.has(m.tool_call_id!)).toBe(true);
    }
  });
});
