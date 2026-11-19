import type { ChatMessage } from "./context-compactor.js";
import type { SessionEntity } from "../storage/interfaces.js";

/**
 * 历史消息重建（TASK-057 自 agent-loop.ts 拆出）：
 *
 * - TASK-008 手动压缩：被折叠轮次不入上下文，改为注入一条摘要占位消息，
 *   使上下文占用断崖回落；折叠轮次之后的历史照常按 checkpoint 快照恢复。
 * - 逐轮按 checkpoint messagesSnapshot 只回放本 turn 提问之后的消息，
 *   避免逐轮全量重放叠加导致 assistant 内容随轮次成倍重复。
 *
 * 纯函数：不读写仓库，返回的消息数组调用方可继续追加（system prompt 由调用方先行压入）。
 */
export function buildHistoryMessages(input: {
  session: Pick<SessionEntity, "turns" | "compaction">;
  /** 本轮用户输入，追加在历史末尾 */
  currentPrompt: string;
}): ChatMessage[] {
  const { session, currentPrompt } = input;
  const messages: ChatMessage[] = [];

  // TASK-008 手动压缩：被折叠轮次不入上下文，改为注入一条摘要占位消息，
  // 使上下文占用断崖回落；折叠轮次之后的历史照常按 checkpoint 快照恢复。
  // （自动滑动窗口裁剪 compact 仍在每步生效，二者互补）
  const compaction = session.compaction;
  if (compaction?.summary) {
    messages.push({ role: "user", content: compaction.summary });
  }

  // 恢复历史会话
  for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex++) {
    const pastTurn = session.turns[turnIndex];
    // 压缩覆盖的轮次：正文已折叠进摘要，跳过原始内容
    if (compaction && turnIndex < compaction.compactedTurnCount) continue;
    messages.push({ role: "user", content: pastTurn.prompt });
    // 提取最新检查点的消息状态（旧数据 errorTurn 可能无 checkpoints 字段，需防御）
    const cps = pastTurn.checkpoints;
    const lastCp = cps && cps.length > 0 ? cps[cps.length - 1] : undefined;
    if (lastCp && Array.isArray(lastCp.messagesSnapshot)) {
      const snapshot = lastCp.messagesSnapshot as ChatMessage[];
      // 快照是「截至本步的完整历史」（含此前轮次），只回放本 turn 提问之后的消息；
      // 逐条全量重放会与更早轮次的快照叠加，assistant 内容随轮次成倍重复
      let start = 0;
      for (let i = snapshot.length - 1; i >= 0; i--) {
        const item = snapshot[i];
        if (item.role === "user" && item.content === pastTurn.prompt) {
          start = i + 1;
          break;
        }
      }
      for (let i = start; i < snapshot.length; i++) {
        const item = snapshot[i];
        if (item.role !== "system" && item.role !== "user") {
          messages.push(item);
        }
      }
    }
  }

  // 追加本轮用户输入
  messages.push({ role: "user", content: currentPrompt });
  return messages;
}
