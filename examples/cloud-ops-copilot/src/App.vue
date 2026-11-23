<script setup lang="ts">
import { ref, computed, nextTick, onMounted, useTemplateRef } from "vue";
import {
  Server,
  Activity,
  AlertTriangle,
  Zap,
  ShieldCheck,
  Bot,
  X,
  Send,
  CheckCircle2,
  Cpu,
  HardDrive,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ChevronDown,
} from "lucide-vue-next";
import {
  VaComposer,
  VaApprovalCard,
  useStickToBottom,
  getCardComponent,
} from "@vuagent/ui";

// 模拟微服务集群列表数据
const services = ref([
  {
    name: "order-service",
    desc: "核心交易与订单创建微服务",
    status: "warning",
    version: "v2.14.0",
    replicas: "2/2",
    cpu: "78%",
    mem: "94% (警戒)",
    qps: "4,820",
    latency: "38ms",
  },
  {
    name: "payment-service",
    desc: "银行渠道网关与支付清结算",
    status: "healthy",
    version: "v1.9.2",
    replicas: "4/4",
    cpu: "32%",
    mem: "45%",
    qps: "1,250",
    latency: "21ms",
  },
  {
    name: "auth-service",
    desc: "统一身份认证与 JWT Token 签发",
    status: "healthy",
    version: "v3.1.0",
    replicas: "3/3",
    cpu: "24%",
    mem: "38%",
    qps: "8,900",
    latency: "8ms",
  },
  {
    name: "inventory-service",
    desc: "分布式库存扣减与仓储调度",
    status: "healthy",
    version: "v2.5.1",
    replicas: "2/2",
    cpu: "41%",
    mem: "56%",
    qps: "2,100",
    latency: "16ms",
  },
]);

// Copilot 抽屉控制与会话状态
const isCopilotOpen = ref(true);
const composerText = ref("");
const isStreaming = ref(false);
const sessionId = ref(`ops-sess-${Date.now()}`);

interface MessageCard {
  id: string;
  component: string;
  props: Record<string, any>;
}

interface PendingApproval {
  id: string;
  title: string;
  detail: string;
  risk: "low" | "medium" | "high";
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  thought?: string;
  showThought?: boolean;
  cards: MessageCard[];
  approval?: PendingApproval;
  approvalDecided?: "approved" | "denied";
}

const turns = ref<ChatTurn[]>([]);
const chatScrollRef = useTemplateRef<HTMLElement>("chatScrollRef");
const { scrollToBottom } = useStickToBottom(chatScrollRef);

// 获取已注册的卡片组件
function resolveCardComponent(name: string) {
  return getCardComponent(name);
}

// 发送 Prompt 驱动真实 Harness Server
async function handleSend(customPrompt?: string) {
  const prompt = (customPrompt || composerText.value).trim();
  if (!prompt || isStreaming.value) return;

  composerText.value = "";
  isCopilotOpen.value = true;

  // 1. 追加用户消息
  turns.value.push({
    id: `user-${Date.now()}`,
    role: "user",
    text: prompt,
    cards: [],
  });

  // 2. 占位 Assistant 消息
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
      body: JSON.stringify({
        prompt,
        sessionId: sessionId.value,
        permission: "review", // 敏感操作阻断审批
      }),
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
            const event = JSON.parse(jsonStr);
            console.log("[CloudOps Copilot SSE Event]", event);
            handleSSEEvent(event, assistantTurn);
          } catch (e) {
            console.warn("解析 SSE JSON 片段失败:", jsonStr, e);
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

// 消费各类服务端事件
function handleSSEEvent(event: any, turn: ChatTurn) {
  switch (event.type) {
    case "text_delta":
      turn.text += event.delta || "";
      break;

    case "thought_delta":
      turn.thought = (turn.thought || "") + (event.delta || "");
      break;

    case "tool_call_executing":
      // 可以记录正在执行的工具名称
      break;

    case "tool_call_result":
    case "tool_result": {
      // 捕获带有 Generative UI component 声明的执行结果
      const raw = event.data || event.result || event.output;
      if (raw && typeof raw === "object" && raw.rendered && raw.component) {
        // 去重判断
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
    case "action_suspended": {
      // 服务端安全拦截：高危写操作挂起，呼出人工审批卡片
      turn.approval = {
        id: event.actionId,
        title: `生产变更安全审批：${event.toolName || "操作"} 申请执行`,
        detail: JSON.stringify(event.args || event.payload || {}, null, 2),
        risk: "high",
      };
      break;
    }

    case "resumed":
    case "action_resumed": {
      turn.approvalDecided = "approved";
      break;
    }

    case "error": {
      turn.text += `\n\n❌ 执行失败：${event.message || "未知错误"}`;
      break;
    }

    case "turn_finish":
      isStreaming.value = false;
      break;
  }
}

// 提交审批决策
async function handleApproval(turn: ChatTurn, approved: boolean, reason?: string) {
  if (!turn.approval) return;
  const actionId = turn.approval.id;
  turn.approvalDecided = approved ? "approved" : "denied";

  try {
    const res = await fetch(`/api/action/${actionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved,
        reason: reason || (approved ? "人工审批确认放行" : "高危操作拒绝"),
        note: reason || (approved ? "人工审批确认放行" : "高危操作拒绝"),
      }),
    });

    if (res.ok && approved) {
      turns.value.push({
        id: `asst-after-${Date.now()}`,
        role: "assistant",
        text: "✅ 已批准操作，服务端继续执行扩容并完成探针就绪检查。",
        cards: [],
      });
    }
  } catch (err: any) {
    console.error("提交审批决策异常:", err);
  }
}

// 快捷 Prompt 引导
function runQuickPrompt(type: "inspect" | "scale" | "security") {
  if (type === "inspect") {
    handleSend("请调用 ops_inspect_cluster 工具巡检 order-service 生产集群健康度并展示状态卡片");
  } else if (type === "scale") {
    handleSend("请调用 ops_scale_replicas 工具紧急将 order-service 副本数扩容至 5 个以分流洪峰流量");
  } else {
    handleSend("对当前生产环境的所有微服务进行一次快速架构安全与告警汇总审计");
  }
}

onMounted(() => {
  turns.value.push({
    id: "init-1",
    role: "assistant",
    text: "你好！我是你的云原生微服务智能副驾驶 (CloudOps Copilot)。\n你可以随时向我提问微服务运行状态、下发集群健康巡检，或针对高负载微服务触发弹性扩容。\n\n试着点击上方的场景演练按钮开始体验：",
    cards: [],
  });
});
</script>

<template>
  <div class="host-layout">
    <!-- 顶部导航栏 -->
    <header class="host-navbar">
      <div class="host-brand">
        <Server :size="18" style="color: #2563eb" />
        <span>CloudOps · 企业级微服务治理大盘</span>
        <span class="host-brand__tag">Production (us-east)</span>
      </div>

      <div class="host-nav-actions">
        <button
          type="button"
          class="btn-open-copilot"
          @click="isCopilotOpen = !isCopilotOpen"
        >
          <Sparkles :size="14" />
          <span>{{ isCopilotOpen ? "收起 AI 运维副驾驶" : "打开 AI 运维副驾驶" }}</span>
        </button>
      </div>
    </header>

    <!-- 宿主主业务大盘内容 -->
    <main class="host-main">
      <section class="host-banner">
        <h1>线上微服务实时监控 (K8s Production)</h1>
        <p>
          本系统接入了 @vuagent/ui 与 @vuagent/server：通过自定义场景工具 (Custom Tools) 与 Generative UI 卡片，
          实现只读智能巡检、高危写操作阻断审批 (HITL) 与实时扩容进度渲染。
        </p>
      </section>

      <!-- 服务列表卡片网格 -->
      <section class="host-grid">
        <div
          v-for="s in services"
          :key="s.name"
          class="service-card"
          :class="{ 'service-card--warn': s.status === 'warning' }"
        >
          <div class="service-card__head">
            <span class="service-card__name">{{ s.name }}</span>
            <span
              class="service-card__badge"
              :class="s.status === 'warning' ? 'badge-warn' : 'badge-ok'"
            >
              {{ s.status === 'warning' ? '预警 (Degraded)' : '正常 (Healthy)' }}
            </span>
          </div>

          <p style="font-size: 12px; color: #64748b; min-height: 36px">
            {{ s.desc }}
          </p>

          <div class="service-card__stats">
            <div class="stat-item">
              <span class="stat-label">Pod 实例</span>
              <span class="stat-val">{{ s.replicas }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">CPU 负载</span>
              <span class="stat-val">{{ s.cpu }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">内存使用</span>
              <span class="stat-val" :style="{ color: s.status === 'warning' ? '#dc2626' : 'inherit' }">
                {{ s.mem }}
              </span>
            </div>
          </div>

          <div class="service-card__actions">
            <button
              type="button"
              class="btn-inspect"
              @click="handleSend(`检查 ${s.name} 的集群健康状况并输出分析`)"
            >
              调用 Copilot 巡检
            </button>
          </div>
        </div>
      </section>
    </main>

    <!-- 右侧 Copilot 侧滑抽屉 -->
    <aside v-if="isCopilotOpen" class="copilot-drawer">
      <!-- 抽屉头部 -->
      <div class="copilot-header">
        <div class="copilot-title">
          <Bot :size="18" style="color: #2563eb" />
          <span>CloudOps Copilot</span>
          <span class="copilot-badge">Server 连接正常</span>
        </div>
        <button
          type="button"
          class="btn-close"
          title="关闭抽屉"
          @click="isCopilotOpen = false"
        >
          <X :size="16" />
        </button>
      </div>

      <!-- 快捷场景动作 Chip 条 -->
      <div class="copilot-quick-chips">
        <span class="chips-label">演练快捷指令：</span>
        <button
          type="button"
          class="chip-btn"
          :disabled="isStreaming"
          @click="runQuickPrompt('inspect')"
        >
          🔍 巡检订单服务状态
        </button>
        <button
          type="button"
          class="chip-btn chip-btn--action"
          :disabled="isStreaming"
          @click="runQuickPrompt('scale')"
        >
          ⚡ 扩容至 5 副本 (审批)
        </button>
      </div>

      <!-- 消息瀑布流区 -->
      <div ref="chatScrollRef" class="copilot-messages">
        <div
          v-for="turn in turns"
          :key="turn.id"
          class="turn-bubble"
          :class="turn.role === 'user' ? 'turn-user' : 'turn-asst'"
        >
          <div class="turn-avatar">
            {{ turn.role === 'user' ? '你' : 'AI' }}
          </div>

          <div class="turn-content">
            <!-- 模型思考折叠框 -->
            <div v-if="turn.thought" class="turn-thought-wrap">
              <button
                type="button"
                class="turn-thought-toggle"
                @click="turn.showThought = !turn.showThought"
              >
                <Sparkles :size="12" />
                <span>思考过程</span>
                <ChevronDown
                  :size="12"
                  :style="{ transform: turn.showThought ? 'rotate(180deg)' : 'none' }"
                />
              </button>
              <div v-show="turn.showThought" class="turn-thought-body">
                {{ turn.thought }}
              </div>
            </div>

            <!-- 文本回复主体 -->
            <div v-if="turn.text" class="turn-text">{{ turn.text }}</div>

            <!-- 动态场景组件渲染 (Generative UI) -->
            <div v-if="turn.cards && turn.cards.length > 0" class="turn-cards">
              <component
                :is="resolveCardComponent(card.component)"
                v-for="card in turn.cards"
                :key="card.id"
                v-bind="card.props"
              />
            </div>

            <!-- 高危操作审批卡片 (HITL 审批) -->
            <div v-if="turn.approval" class="turn-approval-box">
              <VaApprovalCard
                :title="turn.approval.title"
                :detail="turn.approval.detail"
                :risk="turn.approval.risk"
                :decided="turn.approvalDecided ? (turn.approvalDecided === 'approved' ? 'approved' : 'denied') : undefined"
                @approve="() => handleApproval(turn, true)"
                @deny="(reason) => handleApproval(turn, false, reason)"
              />
            </div>
          </div>
        </div>

        <!-- 流式加载中指示 -->
        <div v-if="isStreaming" class="turn-streaming">
          <RefreshCw :size="14" class="va-spin" style="color: #2563eb" />
          <span>大模型正在调用场景工具并执行...</span>
        </div>
      </div>

      <!-- 底部 Composer 输入区 -->
      <div class="copilot-footer">
        <VaComposer
          v-model:text="composerText"
          placeholder="输入任务（如：巡检微服务健康度、扩容 Pod 实例）…"
          :disabled="isStreaming"
          @send="() => handleSend()"
        />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.copilot-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 540px;
  max-width: 90vw;
  height: 100vh;
  background: #ffffff;
  border-left: 1px solid var(--app-border, #e2e8f0);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  font-family: inherit;
}

.copilot-header {
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--app-border, #e2e8f0);
  background: #ffffff;
}

.copilot-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.copilot-badge {
  font-size: 11px;
  padding: 2px 6px;
  background: #dcfce7;
  color: #166534;
  border-radius: 4px;
  font-weight: 500;
}

.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #64748b;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
}

.btn-close:hover {
  background: #f1f5f9;
}

.copilot-quick-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
  flex-wrap: wrap;
}

.chips-label {
  font-size: 11px;
  color: #64748b;
}

.chip-btn {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 999px;
  cursor: pointer;
  color: #334155;
  transition: all 0.15s;
}

.chip-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #2563eb;
  background: #eff6ff;
}

.chip-btn--action:hover:not(:disabled) {
  border-color: #f97316;
  color: #ea580c;
  background: #fff7ed;
}

.copilot-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #fdfdfd;
}

.turn-bubble {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.turn-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.turn-user {
  flex-direction: row-reverse;
}

.turn-user .turn-avatar {
  background: #2563eb;
  color: #ffffff;
}

.turn-user .turn-text {
  background: #2563eb;
  color: #ffffff;
  border-radius: 12px 2px 12px 12px;
}

.turn-asst .turn-avatar {
  background: #eff6ff;
  color: #2563eb;
}

.turn-asst .turn-text {
  background: #f1f5f9;
  color: #1e293b;
  border-radius: 2px 12px 12px 12px;
}

.turn-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 90%;
}

.turn-text {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.turn-thought-wrap {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
  font-size: 11px;
}

.turn-thought-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  background: none;
  border: none;
  cursor: pointer;
  color: #64748b;
  font-size: 11px;
}

.turn-thought-body {
  padding: 6px 8px;
  border-top: 1px dashed #e2e8f0;
  color: #475569;
  line-height: 1.4;
  white-space: pre-wrap;
  background: #ffffff;
}

.turn-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.turn-approval-box {
  margin-top: 4px;
}

.turn-streaming {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #64748b;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 6px;
}

.copilot-footer {
  border-top: 1px solid var(--app-border, #e2e8f0);
  padding: 12px 16px;
  background: #ffffff;
}

.va-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}
</style>
