import { IMAGE_PLACEHOLDER, type ChatContentPart, type ChatMessage } from "./context-compactor.js";
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
    // 提取最新检查点的消息状态（旧数据 errorTurn 可能无 checkpoints 字段，需防御）
    const cps = pastTurn.checkpoints;
    const lastCp = cps && cps.length > 0 ? cps[cps.length - 1] : undefined;

    // TASK-083 历史图片轮占位：图片本体不进上下文（checkpoint 落库前已把 base64
    // 降级为 [图片] 占位，见 sanitizeMessagesForCheckpoint），但必须在回放文本里
    // 显式标注「该轮曾有图」——否则多轮追问（"它是什么品种？"）时模型不知图的存在。
    // 判定来源：① 轮次 attachments 元数据（TASK-050 起）；② 旧数据无元数据时，
    // 看快照锚点消息是否 parts 形态且含图片块（降级前的旧快照）/ [图片] 占位块（降级后）。
    const imageAttCount = pastTurn.attachments?.filter((a) => a.kind === "image").length ?? 0;
    let hadImages = imageAttCount > 0;
    if (!hadImages && lastCp && Array.isArray(lastCp.messagesSnapshot)) {
      const anchor = (lastCp.messagesSnapshot as ChatMessage[]).find(
        (item) =>
          item.role === "user" &&
          Array.isArray(item.content) &&
          (item.content as ChatContentPart[])[0]?.type === "text" &&
          ((item.content as ChatContentPart[])[0] as { text?: string }).text === pastTurn.prompt
      );
      hadImages =
        Array.isArray(anchor?.content) &&
        (anchor.content as ChatContentPart[]).some(
          (p) => p.type === "image_url" || (p.type === "text" && p.text === IMAGE_PLACEHOLDER)
        );
    }
    const imageNote = imageAttCount > 1 ? `[图片]×${imageAttCount}` : IMAGE_PLACEHOLDER;
    messages.push({
      role: "user",
      content: hadImages ? `${pastTurn.prompt}\n${imageNote}` : pastTurn.prompt,
    });

    if (lastCp && Array.isArray(lastCp.messagesSnapshot)) {
      const snapshot = lastCp.messagesSnapshot as ChatMessage[];
      // 快照是「截至本步的完整历史」（含此前轮次），只回放本 turn 提问之后的消息；
      // 逐条全量重放会与更早轮次的快照叠加，assistant 内容随轮次成倍重复
      let start = 0;
      for (let i = snapshot.length - 1; i >= 0; i--) {
        const item = snapshot[i];
        // 图片轮的 user 消息是 content parts（首块 = 提问文本），同样可作回放起点锚
        const isTurnAnchor =
          item.role === "user" &&
          (item.content === pastTurn.prompt ||
            (Array.isArray(item.content) &&
              item.content[0]?.type === "text" &&
              item.content[0].text === pastTurn.prompt));
        if (isTurnAnchor) {
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
