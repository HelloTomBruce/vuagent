import { nextTick, ref, useTemplateRef } from "vue";
import { useStickToBottom } from "@vuagent/ui";

export interface MessageCard {
  id: string;
  component: string;
  props: Record<string, any>;
}

export interface PendingApproval {
  id: string;
  title: string;
  detail: string;
  risk: "low" | "medium" | "high";
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  thought?: string;
  showThought?: boolean;
  cards: MessageCard[];
  approval?: PendingApproval;
  approvalDecided?: "approved" | "denied";
}

export interface AgentChatOptions {
  /** 切换场景后的初始欢迎语 */
  greeting?: string;
}

/**
 * 场景画廊共享聊天引擎：SSE 消费 / Generative UI 卡片挂载 / HITL 审批决策。
 * 全场景复用同一实例；切换场景时 switchScene 重置会话（sessionId 按场景前缀隔离）。
 */
export function useAgentChat(options: AgentChatOptions = {}) {
  const sceneId = ref<string>("cloudops");
  const turns = ref<ChatTurn[]>([]);
  const composerText = ref("");
  const isStreaming = ref(false);
  const sessionId = ref(`gallery-${sceneId.value}-${Date.now()}`);
  const chatScrollRef = useTemplateRef<HTMLElement>("chatScrollRef");
  const { scrollToBottom } = useStickToBottom(chatScrollRef);

  function pushAssistant(text: string) {
    turns.value.push({ id: `asst-${Date.now()}`, role: "assistant", text, cards: [] });
  }

  function reset(greeting?: string) {
    turns.value = [];
    composerText.value = "";
    sessionId.value = `gallery-${sceneId.value}-${Date.now()}`;
    isStreaming.value = false;
    if (greeting) pushAssistant(greeting);
  }

  /** 切换场景：会话与消息流整体重置，避免上下文串味 */
  function switchScene(nextId: string, greeting?: string) {
    if (sceneId.value === nextId) return;
    sceneId.value = nextId;
    reset(greeting);
  }

  /** 发送 Prompt 驱动 Harness Server（permission: "review" 开启高危操作阻断审批） */
  async function send(customPrompt?: string) {
    const prompt = (customPrompt || composerText.value).trim();
    if (!prompt || isStreaming.value) return;

    composerText.value = "";
    turns.value.push({ id: `user-${Date.now()}`, role: "user", text: prompt, cards: [] });

    const assistantTurn: ChatTurn = {
      id: `asst-${Date.now()}`,
      role: "assistant",
      text: "",
      thought: "",
      showThought: true,
      cards: [],
    };
    turns.value.push(assistantTurn);
    isStreaming.value = true;
    await nextTick();
    scrollToBottom({ force: true });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: sessionId.value, permission: "review" }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `请求失败 [${res.status}]`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取服务端 SSE 流");

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const normalized = buffer.replace(/\r\n|\r/g, "\n");
        const parts = normalized.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const block of parts) {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.replace(/^data:\s*/, "").trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              handleEvent(JSON.parse(jsonStr), assistantTurn);
            } catch {
              /* 忽略不完整 SSE 片段 */
            }
          }
        }
      }
    } catch (err: any) {
      assistantTurn.text += `\n\n⚠️ 执行异常: ${err.message || String(err)}`;
    } finally {
      isStreaming.value = false;
      await nextTick();
      scrollToBottom({ force: true });
    }
  }

  /** 消费服务端事件：文本/思考增量、卡片挂载、审批挂起与唤醒 */
  function handleEvent(event: any, turn: ChatTurn) {
    switch (event.type) {
      case "text_delta":
        turn.text += event.delta || "";
        break;

      case "thought_delta":
        turn.thought = (turn.thought || "") + (event.delta || "");
        break;

      case "tool_call_result":
      case "tool_result": {
        const raw = event.data || event.result || event.output;
        if (raw && typeof raw === "object" && raw.rendered && raw.component) {
          const exists = turn.cards.some((c) => c.component === raw.component);
          if (!exists) {
            turn.cards.push({
              id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              component: raw.component,
              props: raw.props || {},
            });
          }
        }
        break;
      }

      case "suspended":
      case "action_suspended":
        turn.approval = {
          id: event.actionId,
          title: `高危操作安全审批：${event.toolName || "操作"} 申请执行`,
          detail: JSON.stringify(event.args || event.payload || {}, null, 2),
          risk: "high",
        };
        break;

      case "resumed":
      case "action_resumed":
        turn.approvalDecided = "approved";
        break;

      case "error":
        turn.text += `\n\n❌ 执行失败：${event.message || "未知错误"}`;
        break;

      case "turn_finish":
        isStreaming.value = false;
        break;
    }
    nextTick(() => scrollToBottom());
  }

  /** 提交审批决策：POST /api/action/:id 唤醒挂起的服务端执行链（或按拒绝语义终止） */
  async function decide(turn: ChatTurn, approved: boolean, reason?: string) {
    if (!turn.approval) return;
    const actionId = turn.approval.id;
    turn.approvalDecided = approved ? "approved" : "denied";
    const note = reason || (approved ? "人工审批确认放行" : "高危操作已驳回");

    try {
      const res = await fetch(`/api/action/${actionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, reason: note, note }),
      });
      if (res.ok && approved) {
        pushAssistant("✅ 已批准，agent 正在继续执行，结果会以卡片形式挂到本轮消息下方。");
      }
    } catch (err) {
      console.error("提交审批决策异常:", err);
    }
  }

  reset(options.greeting);

  return {
    sceneId,
    turns,
    composerText,
    isStreaming,
    sessionId,
    chatScrollRef,
    send,
    decide,
    switchScene,
  };
}
