/**
 * 单快照重放（W2 S-based）+ 评审 R5 回归：
 * - 正常路径：快照含此前轮次 → 单次重放得到完整历史，提问不重复、system 不重复；
 * - 锚定失败：存库 prompt 与快照消息文本不一致时，轮次必须**保留**（位置兜底），不得静默丢弃；
 * - 压缩：被折叠轮次不进上下文，摘要只出现一次。
 */
import { describe, it, expect } from "vitest";
import { buildHistoryMessages } from "../src/core/history-builder.js";
import type { SessionEntity, TurnEntity } from "../src/storage/interfaces.js";

function turn(id: string, prompt: string, content: string): TurnEntity {
  return {
    id, sessionId: "s1", prompt, content, status: "done", stepCount: 1,
    checkpoints: [{ id: `cp-${id}`, turnId: id, stepIndex: 1, snapshotAt: 1 }],
    createdAt: 1,
  };
}

const session = (turns: TurnEntity[], compaction?: SessionEntity["compaction"]) =>
  ({ turns, compaction }) as Pick<SessionEntity, "turns" | "compaction">;

describe("buildHistoryMessages · 单快照重放", () => {
  it("快照含此前轮次：一次重放得到完整历史，当前提问不重复", () => {
    const turns = [turn("t1", "第一问", "第一答"), turn("t2", "第二问", "第二答")];
    const snapshot = [
      { role: "system", content: "SYS" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
      { role: "assistant", content: "第二答" },
    ] as never;

    const msgs = buildHistoryMessages({ session: session(turns), currentPrompt: "第三问", latestSnapshot: snapshot });
    const text = JSON.stringify(msgs);
    expect(text).toContain("第一问");
    expect(text).toContain("第一答");
    expect(text).toContain("第二问");
    expect(text).toContain("第三问");
    // system 由调用方压入，重放不带
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(0);
    // 提问只出现一次
    expect(text.split("第一问").length - 1).toBe(1);
    // 最后一条是当前提问
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "第三问" });
  });

  it("锚定失败（prompt 文本被改写）时轮次仍保留（R5：位置兜底，不静默丢弃）", () => {
    const turns = [turn("t1", "原始提问", "第一答")];
    // 快照里的 user 文本与存库 prompt 不一致（附件内联/规范化场景）
    const snapshot = [
      { role: "user", content: "[附件] notes.txt\n原始提问" },
      { role: "assistant", content: "第一答" },
    ] as never;

    const msgs = buildHistoryMessages({ session: session(turns), currentPrompt: "追问", latestSnapshot: snapshot });
    const text = JSON.stringify(msgs);
    // 关键：该轮 prompt 不能消失
    expect(text).toContain("原始提问");
    expect(text).toContain("第一答");
  });

  it("压缩：被折叠轮次不进上下文，摘要只出现一次", () => {
    const turns = [turn("t1", "旧问", "旧答"), turn("t2", "新问", "新答")];
    const snapshot = [
      { role: "user", content: "SUMMARY: 之前的对话摘要" },
      { role: "user", content: "新问" },
      { role: "assistant", content: "新答" },
    ] as never;
    const compaction = { compactedTurnCount: 1, summary: "SUMMARY: 之前的对话摘要", checkpointId: "cp-x", beforeTokens: 1, afterTokens: 1, compactedAt: 1 } as SessionEntity["compaction"];

    const msgs = buildHistoryMessages({ session: session(turns, compaction), currentPrompt: "继续", latestSnapshot: snapshot });
    const text = JSON.stringify(msgs);
    expect(text).not.toContain("旧问");
    expect(text).toContain("新问");
    expect(text.split("SUMMARY: 之前的对话摘要").length - 1).toBe(1);
  });

  it("无 latestSnapshot（inline 形态）仍走逐轮回放，行为不变", () => {
    const turns = [turn("t1", "旧问", "旧答")];
    turns[0].checkpoints = [
      { id: "cp-1", turnId: "t1", stepIndex: 1, snapshotAt: 1, messagesSnapshot: [
        { role: "user", content: "旧问" }, { role: "assistant", content: "旧答" },
      ] } as never,
    ];
    const msgs = buildHistoryMessages({ session: session(turns), currentPrompt: "新问" });
    const text = JSON.stringify(msgs);
    expect(text).toContain("旧问");
    expect(text).toContain("旧答");
  });
});
