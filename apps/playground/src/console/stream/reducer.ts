/**
 * 流事件 → MessageTurn 归约器（纯函数，可单测）
 * 事件类型来自 @vuagent/protocol 的 HarnessStreamEvent（TASK-002 统一契约）。
 * - 卡片写入直接原地修改 turn（保持引用语义，流式期间视图即时更新）
 * - ui_agent_plan 仅在事件属于当前激活会话时通过 sink 上抛
 * - tool_call_result 携带 UiComponentRenderResult({component, props}) 时分发为对应卡片
 * - 卡片 id 以 toolCallId 派生，重复重放（断线重连）自动去重
 */
import type {
  HarnessStreamEvent,
  UiComponentRenderResult,
} from "@vuagent/protocol";
import type { ActionCard, MessageTurn, PlanStep } from "../types";

export interface StreamEventContext {
  /** 该事件是否属于当前激活会话 */
  isActiveSession: boolean;
}

export interface ReducerSink {
  /** ui_agent_plan / ui_agent_plan 工具结果：全量同步任务计划（仅激活会话时回调） */
  setPlanSteps: (steps: PlanStep[]) => void;
}

function ensureCards(turn: MessageTurn): NonNullable<MessageTurn["cards"]> {
  turn.cards = turn.cards || [];
  return turn.cards;
}

/** 按 id 去重写入卡片（重连重放场景下同一 toolCallId 的卡片不重复） */
function pushCardUnique(turn: MessageTurn, card: ActionCard): ActionCard {
  const cards = ensureCards(turn);
  const existing = cards.find((c) => c.id === card.id);
  if (existing) return existing;
  cards.push(card);
  return card;
}

/* ==========================================================================
   输出时序块（blocks）：卡片按发生位置插入文本流
   ========================================================================== */

function appendTextBlock(turn: MessageTurn, text: string): void {
  if (!text) return;
  if (!turn.blocks) turn.blocks = [];
  const last = turn.blocks[turn.blocks.length - 1];
  if (last && last.kind === "text") {
    last.content += text;
  } else {
    turn.blocks.push({ kind: "text", content: text });
  }
}

function placeCardBlock(turn: MessageTurn, cardId: string): void {
  if (!turn.blocks) turn.blocks = [];
  if (turn.blocks.some((b) => b.kind === "card" && b.cardId === cardId)) return;
  turn.blocks.push({ kind: "card", cardId });
}

function placeTurnCard(turn: MessageTurn, card: ActionCard): ActionCard {
  const placed = pushCardUnique(turn, card);
  placeCardBlock(turn, placed.id);
  return placed;
}

/**
 * UI 工具结果 → 卡片分发（打通「模型调 ui_* 工具 → 前端渲染」断链）
 */
export function applyUiComponentResult(
  turn: MessageTurn,
  data: unknown,
  toolCallId: string,
  sink: ReducerSink
): void {
  const result = data as UiComponentRenderResult | null | undefined;
  if (!result || typeof result !== "object" || !result.component) return;

  const props = (result.props || {}) as Record<string, any>;

  switch (result.component) {
    case "ui_code_diff":
      placeTurnCard(turn, {
        id: `diff-${toolCallId}`,
        type: "diff",
        data: {
          file: props.fileName || "untitled.ts",
          oldCode: props.oldText || "",
          newCode: props.newText || "",
          view: props.layout || "unified",
        },
      });
      break;

    case "ui_metric_chart":
      placeTurnCard(turn, {
        id: `metric-${toolCallId}`,
        type: "metric",
        data: {
          title: props.title || "指标图表",
          series: Array.isArray(props.series) ? props.series : [],
        },
      });
      break;

    case "ui_agent_plan":
      if (Array.isArray(props.steps)) {
        sink.setPlanSteps(props.steps as PlanStep[]);
      }
      break;

    case "ui_file_tree":
      placeTurnCard(turn, {
        id: `tree-${toolCallId}`,
        type: "tree",
        data: {
          title: props.title,
          tree: Array.isArray(props.tree) ? props.tree : [],
          defaultExpandDepth: props.defaultExpandDepth,
        },
      });
      break;

    case "ui_trajectory":
      placeTurnCard(turn, {
        id: `traj-${toolCallId}`,
        type: "trajectory",
        data: {
          events: Array.isArray(props.events) ? props.events : [],
          ledgerMaxHeight: props.ledgerMaxHeight,
        },
      });
      break;

    case "ui_approval_card":
      // 审批卡片由 suspended/resumed 的 HITL 流负责渲染，工具结果无需重复建卡
      break;
  }
}

export function applyStreamEvent(
  turn: MessageTurn,
  event: HarnessStreamEvent,
  ctx: StreamEventContext,
  sink: ReducerSink
): void {
  switch (event.type) {
    case "text_delta":
      turn.content += event.delta || "";
      appendTextBlock(turn, event.delta || "");
      break;

    case "thought_delta":
      turn.thought = (turn.thought || "") + (event.delta || "");
      break;

    case "error":
      {
        const msg = `\n\n⚠️ **执行提示**：${event.message || "请求执行遇到错误"}`;
        turn.content += (turn.content ? "\n\n" : "") + msg.trimStart();
        appendTextBlock(turn, msg);
      }
      break;

    case "ui_agent_plan":
      if (event.steps && Array.isArray(event.steps)) {
        if (ctx.isActiveSession) {
          sink.setPlanSteps(event.steps);
        }
      }
      break;

    case "ui_code_diff":
      // 事件源卡片沿用 Date.now() id（与原实现一致），工具结果卡片才做 toolCallId 去重
      placeTurnCard(turn, {
        id: `diff-${Date.now()}`,
        type: "diff",
        data: {
          file: event.file || "untitled.ts",
          additions: event.additions || 0,
          deletions: event.deletions || 0,
          oldCode: event.oldCode || "",
          newCode: event.newCode || "",
          view: "side-by-side",
        },
      });
      break;

    case "ui_terminal_log":
      placeTurnCard(turn, {
        id: `term-${Date.now()}`,
        type: "terminal",
        data: {
          title: event.title || "沙箱命令执行",
          lines: event.lines || [
            { text: `$ npm run build`, kind: "cmd" },
            {
              text: "Build finished successfully in 410ms.",
              kind: "stdout",
            },
          ],
        },
      });
      break;

    case "ui_metric_chart":
      placeTurnCard(turn, {
        id: `metric-${Date.now()}`,
        type: "metric",
        data: {
          title: event.title || "指标图表",
          series: Array.isArray(event.points)
            ? event.points.map((p) => ({ label: p.time, value: p.value }))
            : [],
        },
      });
      break;

    case "suspended": {
      const cards = ensureCards(turn);
      if (!cards.some((c) => c.data?.actionId === event.actionId)) {
        const card: ActionCard = {
          id: event.actionId,
          type: "approval",
          data: {
            actionId: event.actionId,
            risk: "high",
            title: event.toolName
              ? `工具 [${event.toolName}] 申请权限`
              : "高风险操作介入确认",
            command: JSON.stringify(event.args || {}, null, 2),
            status: "pending",
            expiresInSec: Math.round((event.timeoutMs || 60000) / 1000),
          },
        };
        cards.push(card);
        placeCardBlock(turn, card.id);
      }
      break;
    }

    case "resumed": {
      if (turn.cards && event.actionId) {
        const card = turn.cards.find(
          (c) =>
            c.data?.actionId === event.actionId ||
            c.id === event.actionId ||
            c.id === `approval-${event.actionId}`
        );
        if (card) {
          const payload = (event.payload || {}) as {
            approved?: boolean;
            reason?: string;
            note?: string;
          };
          card.data.status = payload.approved ? "approved" : "denied";
          card.data.reason = payload.note || payload.reason;
        }
      }
      break;
    }

    case "tool_call_start":
      // 工具调用链卡片：streaming（参数生成中）→ executing → done/error
      placeTurnCard(turn, {
        id: `call-${event.toolCallId}`,
        type: "toolcall",
        data: {
          toolName: event.toolName,
          status: "streaming",
          args: {},
          startedAt: Date.now(),
        },
      });
      break;

    case "tool_call_args_delta": {
      // 渐进渲染：模型吐出的半截 JSON 实时回填到调用卡片
      const deltaCard = turn.cards?.find(
        (c) => c.id === `call-${event.toolCallId}`
      );
      if (deltaCard && deltaCard.type === "toolcall") {
        deltaCard.data.args = event.partialArgs || {};
      }
      break;
    }

    case "tool_call_executing": {
      const execCard = turn.cards?.find(
        (c) => c.id === `call-${event.toolCallId}`
      );
      if (execCard && execCard.type === "toolcall") {
        execCard.data.status = "executing";
        execCard.data.args = event.args || {};
      }
      break;
    }

    case "tool_call_result": {
      // 收敛调用链卡片状态（成功/失败/耗时/结果）
      const callCard = turn.cards?.find(
        (c) => c.id === `call-${event.toolCallId}`
      );
      if (callCard && callCard.type === "toolcall") {
        callCard.data.status = event.status === "error" ? "error" : "done";
        callCard.data.result = event.data;
        callCard.data.error = event.error;
        callCard.data.duration = callCard.data.startedAt
          ? Date.now() - callCard.data.startedAt
          : undefined;
      }

      // 沙箱系统工具：bash_run 以终端卡片展示原始输出
      if (event.toolName === "bash_run") {
        placeTurnCard(turn, {
          id: `term-${event.toolCallId}`,
          type: "terminal",
          data: {
            title: `终端执行: ${event.toolName}`,
            lines: [
              { text: `$ [状态: ${event.status}]`, kind: "cmd" },
              {
                text:
                  typeof event.data === "string"
                    ? event.data
                    : JSON.stringify(event.data || event.error || ""),
                kind: event.status === "error" ? "err" : "stdout",
              },
            ],
          },
        });
        break;
      }
      // 契约 UI 工具：{component, props} → 卡片分发
      applyUiComponentResult(turn, event.data, event.toolCallId, sink);
      break;
    }
  }
}
