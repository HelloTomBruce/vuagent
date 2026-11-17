/**
 * HITL 审批数据域：提交决策 + 当前视图/跨会话缓存双同步
 * 从原 Console.vue#submitApproval 平移
 */
import type { Ref } from "vue";
import { submitAction } from "../api/client";
import type { MessageTurn } from "../types";

export interface ApprovalsOptions {
  chatTurns: Ref<MessageTurn[]>;
  sessionTurnsCache: Map<string, MessageTurn[]>;
}

export function useApprovals(options: ApprovalsOptions) {
  function syncCardStatus(
    turns: MessageTurn[],
    actionId: string,
    approved: boolean,
    reason?: string
  ) {
    for (const turn of turns) {
      if (!turn.cards) continue;
      const card = turn.cards.find(
        (c) =>
          c.data?.actionId === actionId ||
          c.id === actionId ||
          c.id === `approval-${actionId}`
      );
      if (card) {
        card.data.status = approved ? "approved" : "denied";
        card.data.reason = reason;
      }
    }
  }

  /**
   * 提交 HITL 决策。第三个参数为人工填写的备注/驳回原因，
   * 契约语义对齐 @vuagent/protocol ApprovalActionPayload：reason 仅用于 manual/timeout 成因，文本走 note
   */
  async function submitApproval(actionId: string, approved: boolean, note?: string) {
    let ok = false;
    try {
      ok = await submitAction(actionId, { approved, note });
    } catch (e) {
      console.error("提交审批失败:", e);
      return;
    }
    if (!ok) return;

    // 1. 同步更新当前会话视图卡片状态
    syncCardStatus(options.chatTurns.value, actionId, approved, note);
    // 2. 同步更新各会话本地缓存中的卡片状态
    for (const [, cachedTurns] of options.sessionTurnsCache.entries()) {
      syncCardStatus(cachedTurns, actionId, approved, note);
    }
  }

  return { submitApproval };
}
