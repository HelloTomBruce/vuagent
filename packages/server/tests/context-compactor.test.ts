import { describe, expect, it } from "vitest";
import { ContextCompactor, type ChatMessage } from "../src/core/context-compactor.js";

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
