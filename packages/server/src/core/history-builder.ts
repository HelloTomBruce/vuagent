import { IMAGE_PLACEHOLDER, type ChatContentPart, type ChatMessage } from "./context-compactor.js";
import { isFullCheckpoint, type CheckpointEntity, type SessionEntity } from "../storage/interfaces.js";

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
  /**
   * 会话级最新 checkpoint 快照（0.7.0 W2 拆行形态）：快照是「截至该步的完整历史」，
   * 天然包含此前所有轮次的内容——单次重放即可重建历史，替代逐轮内联快照回放
   * （后者在拆行后 turn 行无快照可读，且原本就是 O(N²) 数据量）。
   * 传入时走单快照重放算法；缺省（inline 形态 / 无快照）走既有逐轮回放，逐字不变。
   */
  latestSnapshot?: ChatMessage[] | null;
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

  // ── W2 拆行形态：单快照重放 ──────────────────────────────────────────
  // 语义对齐逐轮回放：输出 = 各未压缩轮次的 user prompt（含图片占位注记）+
  // 各轮 assistant/tool 消息，顺序即真实对话顺序。实现上单次遍历 latestSnapshot：
  // - system 跳过；
  // - user 消息锚定某轮 prompt → 发该轮 prompt+注记（锚点之间漏掉的未压缩轮
  //   一并补发，保持轮次序）；等于压缩摘要 → 原样保留（与逐轮算法的摘要注入同位）；
  //   其它 user（理论不存在）丢弃——对齐逐轮回放「切片内不含 user」的口径；
  // - assistant/tool 原样重放。
  // 遍历结束后补发未被锚定的未压缩轮（如中途 error 轮无 checkpoint，其 prompt
  // 仍会出现在后续快照里——live 上下文含它们；真正的尾部缺失轮在末尾补发）。
  if (input.latestSnapshot && input.latestSnapshot.length > 0) {
    const snapshot = input.latestSnapshot;
    const isCompacted = (index: number) =>
      Boolean(compaction && index < compaction.compactedTurnCount);
    const matchesPrompt = (item: ChatMessage, prompt: string): boolean =>
      item.role === "user" &&
      (item.content === prompt ||
        (Array.isArray(item.content) &&
          (item.content as ChatContentPart[])[0]?.type === "text" &&
          ((item.content as ChatContentPart[])[0] as { text?: string }).text === prompt));

    let turnPointer = 0;
    for (const item of snapshot) {
      if (item.role === "system") continue;

      if (item.role === "user") {
        // 压缩摘要消息原样保留（与逐轮算法顶部的 summary 注入同位同义）
        if (compaction?.summary && item.content === compaction.summary) {
          continue; // 已在函数开头注入过，跳过快照里的同文副本
        }
        // 锚定某轮 prompt → 发该轮 prompt+注记
        let anchored = -1;
        for (let i = turnPointer; i < session.turns.length; i++) {
          if (isCompacted(i)) continue;
          if (matchesPrompt(item, session.turns[i].prompt)) {
            anchored = i;
            break;
          }
        }
        if (anchored >= 0) {
          // 锚点之间的未压缩轮（无快照出现在该快照中的轮）按序补发 prompt
          for (let i = turnPointer; i < anchored; i++) {
            if (!isCompacted(i)) emitTurnPrompt(messages, session.turns[i]);
          }
          emitTurnPrompt(messages, session.turns[anchored]);
          turnPointer = anchored + 1;
        } else {
          // 评审 R5：锚定失败（存库 prompt 与快照消息文本不一致——附件内联、压缩改写、
          // 空白规范化等）时**不能静默丢弃**该 user 消息，否则上下文里那条提问直接消失。
          // 位置兜底：把下一个未压缩未消费轮按序发出（轮次顺序由 turnPointer 保证）。
          for (let i = turnPointer; i < session.turns.length; i++) {
            if (isCompacted(i)) continue;
            emitTurnPrompt(messages, session.turns[i]);
            turnPointer = i + 1;
            break;
          }
        }
        continue;
      }

      // assistant / tool：原样重放
      messages.push(item);
    }
    // 尾部补发：未被快照覆盖的未压缩轮（含最后一轮之后的轮次）
    for (let i = turnPointer; i < session.turns.length; i++) {
      if (!isCompacted(i)) emitTurnPrompt(messages, session.turns[i]);
    }

    messages.push({ role: "user", content: currentPrompt });
    return messages;
  }

  // ── 既有逐轮回放（inline 形态，逐字保持）─────────────────────────────
  // 恢复历史会话
  for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex++) {
    const pastTurn = session.turns[turnIndex];
    // 压缩覆盖的轮次：正文已折叠进摘要，跳过原始内容
    if (compaction && turnIndex < compaction.compactedTurnCount) continue;
    // 提取最新检查点的消息状态（旧数据 errorTurn 可能无 checkpoints 字段，需防御）
    // inline 形态承载完整实体（含快照）；split 形态本函数不会走到（latestSnapshot 分支已接管）。
    // 用类型守卫收窄而不是裸 as——旧数据与拆行数据的边界显式化（评审 O3）。
    const cps = (pastTurn.checkpoints ?? []).filter(isFullCheckpoint);
    const lastCp: CheckpointEntity | undefined = cps.length > 0 ? cps[cps.length - 1] : undefined;

    // TASK-083 历史图片轮占位：图片本体不进上下文（checkpoint 落库前已把 base64
    // 降级为 [图片] 占位，见 sanitizeMessagesForCheckpoint），但必须在回放文本里
    // 显式标注「该轮曾有图」——否则多轮追问（"它是什么品种？"）时模型不知图的存在。
    // 判定来源：① 轮次 attachments 元数据（TASK-050 起）；② 旧数据无元数据时，
    // 看快照锚点消息是否 parts 形态且含图片块（降级前的旧快照）/ [图片] 占位块（降级后）。
    const imageAttCount = pastTurn.attachments?.filter((a) => a.kind === "image").length ?? 0;
    // W2：收尾算好的 hasImages 标记优先；旧数据（无标记）回退快照锚点检测（原口径）
    let hadImages = imageAttCount > 0 || pastTurn.hasImages === true;
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

/** 发某轮的 user prompt（含 TASK-083 图片轮占位注记）——单快照重放与逐轮回放共用 */
function emitTurnPrompt(messages: ChatMessage[], pastTurn: SessionEntity["turns"][number]): void {
  const imageAttCount = pastTurn.attachments?.filter((a) => a.kind === "image").length ?? 0;
  const hadImages = imageAttCount > 0 || pastTurn.hasImages === true;
  const imageNote = imageAttCount > 1 ? `[图片]×${imageAttCount}` : IMAGE_PLACEHOLDER;
  messages.push({
    role: "user",
    content: hadImages ? `${pastTurn.prompt}\n${imageNote}` : pastTurn.prompt,
  });
}
