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

/** L2 表单挂起（ui_form）：actionId + 模型给出的表单参数（title/fields 等） */
export interface PendingForm {
  id: string;
  args: Record<string, any>;
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
  form?: PendingForm;
  /** pending 待填 / done 已提交 / cancelled 用户放弃 */
  formStatus?: "pending" | "done" | "cancelled";
  /** server 422 回填的逐字段错误（重填闭环：表单保持可编辑） */
  formErrors?: Record<string, string>;
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
    // 关键（TASK-001 教训在画廊的复现）：push 之后必须从 reactive 数组回取**代理对象**，
    // 后续 SSE 事件全部变更代理——直接改 raw 引用绕过依赖追踪，suspended 挂起后
    // 没有任何后续渲染触发点，表单/审批卡会永远不出现（界面停在「正在分析中」）。
    const trackedTurn = turns.value[turns.value.length - 1] as ChatTurn;
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
              handleEvent(JSON.parse(jsonStr), trackedTurn);
            } catch {
              /* 忽略不完整 SSE 片段 */
            }
          }
        }
      }
    } catch (err: any) {
      trackedTurn.text += `\n\n⚠️ 执行异常: ${err.message || String(err)}`;
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
        // ui_form（L2 值采集）挂起：渲染表单卡而非审批卡——回传统一走信封
        if (event.toolName === "ui_form") {
          turn.form = { id: event.actionId, args: event.args || {} };
          turn.formStatus = "pending";
          break;
        }
        turn.approval = {
          id: event.actionId,
          title: `高危操作安全审批：${event.toolName || "操作"} 申请执行`,
          detail: JSON.stringify(event.args || event.payload || {}, null, 2),
          risk: "high",
        };
        break;

      case "resumed":
      case "action_resumed":
        if (turn.form && turn.formStatus === "pending") turn.formStatus = "done";
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

  /**
   * 提交表单（L2 信封通道）：submit 携带 values + editedFields；
   * server 422 + fieldErrors（校验失败）时回填到表单就地修正——不唤醒即不算终态，
   * 表单保持可编辑，用户修正后重提交。
   */
  async function submitForm(turn: ChatTurn, values: Record<string, unknown>, editedFields: string[]) {
    if (!turn.form) return;
    turn.formErrors = undefined;
    try {
      const res = await fetch(`/api/action/${turn.form.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "submit", values, meta: { editedFields } }),
      });
      if (res.ok) {
        turn.formStatus = "done";
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as { fieldErrors?: Record<string, string> } | null;
        if (body?.fieldErrors && Object.keys(body.fieldErrors).length > 0) {
          turn.formErrors = body.fieldErrors;
          return;
        }
      }
      pushAssistant(`⚠️ 表单提交失败（HTTP ${res.status}），请重试。`);
    } catch (err) {
      console.error("提交表单异常:", err);
    }
  }

  /** 放弃表单：cancel 是一等公民（放弃 ≠ 失败），模型按用户意图继续而非重试 */
  async function cancelForm(turn: ChatTurn) {
    if (!turn.form) return;
    try {
      const res = await fetch(`/api/action/${turn.form.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "cancel" }),
      });
      if (res.ok) turn.formStatus = "cancelled";
    } catch (err) {
      console.error("取消表单异常:", err);
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
    submitForm,
    cancelForm,
    switchScene,
  };
}
