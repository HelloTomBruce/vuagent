/**
 * 输出时序块的历史重建（TASK-004 UX 追加）
 * 服务端持久化的 approval 卡自 TASK-004 起携带 data.contentOffset
 * （审批挂起发生时已累计的正文长度），据此把卡片插回文本流中的真实位置；
 * 无偏移的旧数据卡片按原顺序追加到正文之后（与旧行为一致）
 */
import type { ActionCard, TurnBlock } from "../types";

export function rebuildBlocksFromHistory(
  content: string,
  cards: ActionCard[]
): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let cursor = 0;

  const positioned = cards
    .filter((c) => typeof c.data?.contentOffset === "number")
    .sort((a, b) => a.data.contentOffset - b.data.contentOffset);

  for (const card of positioned) {
    const offset = Math.min(
      Math.max(card.data.contentOffset as number, 0),
      content.length
    );
    if (offset > cursor) {
      blocks.push({ kind: "text", content: content.slice(cursor, offset) });
    }
    blocks.push({ kind: "card", cardId: card.id });
    cursor = Math.max(cursor, offset);
  }

  if (content.length > cursor || blocks.length === 0) {
    blocks.push({ kind: "text", content: content.slice(cursor) });
  }

  for (const card of cards) {
    if (typeof card.data?.contentOffset !== "number") {
      blocks.push({ kind: "card", cardId: card.id });
    }
  }

  return blocks;
}
