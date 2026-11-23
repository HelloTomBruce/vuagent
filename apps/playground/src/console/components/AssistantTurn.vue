<script setup lang="ts">
/**
 * 助手消息 Turn：思考折叠区 + 输出时序块(文本/卡片交错) + 消息操作 + 流式指示器
 * turn 为 reactive 代理对象，thoughtExpanded 原地切换（与原实现一致）
 * 三泳道轨迹（turn.trajEvents）不再内联渲染，由右侧边栏轨迹 tab 聚合展示
 *
 * 统一过程折叠（用户反馈）：turn 结束后把「思考过程 + 工具调用卡片」收进一条
 * 「已完成 · 耗时 Ns」摘要条（文本结果保持可见），点击摘要条随时展开回过程区。
 */
import { computed, onMounted, ref, watch } from "vue";
import { Bot } from "lucide-vue-next";
import { VaMessageActions, VaMarkdown, VaThoughtBox } from "@vuagent/ui";
import CardRenderer from "./CardRenderer.vue";
import {
  shouldCollapseProcessOnFinish,
  shouldCollapseThoughtOnFinish,
} from "../utils/auto-collapse";
import { useInteractionSettings } from "../composables/useInteractionSettings";
import type { ActionCard, MessageTurn, TurnBlock } from "../types";

const props = defineProps<{ turn: MessageTurn }>();

/** TASK-054：中止成因的可读标签 */
const abortReasonLabel = computed(() => {
  switch (props.turn.abortedReason) {
    case "user":
      return "手动停止";
    case "timeout":
      return "看门狗超时";
    case "preempt":
      return "被新请求顶替";
    case "process_restart":
      return "服务重启中断";
    case "token_budget":
      return "token 预算熔断";
    default:
      return "";
  }
});

const { settings } = useInteractionSettings();

/* ---------- 统一过程折叠（摘要条） ---------- */
const processCollapsed = ref(false);
/** 完成时刻的总耗时（秒）：完成后一次性计算；历史恢复的 turn 无从得知真实耗时，不展示该段 */
const finishDurationSec = ref<number | null>(null);

/** 是否存在可收起的「过程」内容：思考文本或工具调用卡（纯文本回答没有过程，不出摘要条） */
const hasHideableProcess = computed(
  () => Boolean(props.turn.thought) || (props.turn.cards || []).some((c) => c.type === "toolcall")
);

/** 摘要条上的工具调用次数 */
const processToolCount = computed(
  () => (props.turn.cards || []).filter((c) => c.type === "toolcall").length
);

/**
 * 完成后自动折叠（TASK-016 + 统一摘要条修订）：仅在 isStreaming 由 true→false 的
 * 跳变时刻触发。两项开关均开 → 整体收进摘要条；否则维持独立折叠行为。
 * 流式进行中不触发（用户手动展开/收起不被覆盖）。
 */
watch(
  () => props.turn.isStreaming,
  (streaming, prev) => {
    if (prev !== true || streaming !== false) return;
    if (shouldCollapseThoughtOnFinish(settings.value)) {
      props.turn.thoughtExpanded = false;
    }
    if (shouldCollapseProcessOnFinish(settings.value) && hasHideableProcess.value) {
      finishDurationSec.value = Math.round((Date.now() - props.turn.timestamp) / 100) / 10;
      processCollapsed.value = true;
    }
  }
);

// 历史会话恢复：turn 挂载时已是完成态，直接落摘要条（真实耗时未知，不展示耗时段）
onMounted(() => {
  if (!props.turn.isStreaming && hasHideableProcess.value && shouldCollapseProcessOnFinish(settings.value)) {
    processCollapsed.value = true;
  }
});

defineEmits<{
  (e: "approve", actionId: string): void;
  (e: "deny", actionId: string, reason?: string): void;
  (e: "regenerate", turnId: string): void;
  (e: "feedback", kind: "up" | "down" | null, reason?: string): void;
}>();

const cardById = computed<Record<string, ActionCard>>(() => {
  const map: Record<string, ActionCard> = {};
  for (const c of props.turn.cards || []) map[c.id] = c;
  return map;
});

/** 展示块：优先 reducer 增量构建的 blocks；无块信息时回退「正文+卡片」两段式 */
const displayBlocks = computed<TurnBlock[]>(() => {
  const t = props.turn;
  if (t.blocks && t.blocks.length) return t.blocks;
  const blocks: TurnBlock[] = [];
  if (t.content) blocks.push({ kind: "text", content: t.content });
  for (const c of t.cards || []) blocks.push({ kind: "card", cardId: c.id });
  return blocks;
});

</script>

<template>
  <div class="va-console__assistant-turn">
    <div class="va-console__agent-avatar">
      <Bot :size="18" />
    </div>

    <div class="va-console__turn-body">
      <!-- 0 & 1. 思考过程 / 过程摘要条（统一使用 @vuagent/ui 的 VaThoughtBox） -->
      <VaThoughtBox
        v-if="hasHideableProcess || (turn.isStreaming && !turn.content)"
        :thought="turn.thought"
        :expanded="turn.thoughtExpanded"
        :duration="finishDurationSec ?? turn.thoughtDuration"
        :streaming="turn.isStreaming && !turn.content"
        :summary-mode="processCollapsed"
        :tool-count="processToolCount"
        @update:expanded="(val) => turn.thoughtExpanded = val"
        @update:summary-mode="(val) => processCollapsed = val"
      />

      <!-- 2. 输出时序块：文本(Markdown)与卡片按真实输出顺序交错，审批卡不再堆在消息末尾 -->
      <template v-for="(block, bi) in displayBlocks" :key="`${block.kind}-${bi}`">
        <div v-if="block.kind === 'text' && block.content" class="va-console__markdown-content">
          <VaMarkdown
            :content="block.content"
            :streaming="turn.isStreaming && bi === displayBlocks.length - 1"
          />
        </div>

        <div v-else-if="!processCollapsed && block.kind === 'card' && cardById[block.cardId]" class="va-console__action-cards">
          <CardRenderer
            :card="cardById[block.cardId]"
            :turn-streaming="turn.isStreaming"
            @approve="$emit('approve', cardById[block.cardId].data.actionId)"
            @deny="(reason) => $emit('deny', cardById[block.cardId].data.actionId, reason)"
          />
        </div>
      </template>

      <!-- 3. 消息操作：复制 / 重发 / 反馈（输出结束后可操作） -->
      <VaMessageActions
        v-if="!turn.isStreaming && turn.content"
        :text="turn.content"
        quiet
        class="va-console__message-actions"
        @regenerate="$emit('regenerate', turn.id)"
        @feedback="(kind, reason) => $emit('feedback', kind, reason)"
      />

      <!-- 4. 流式输出光标 -->
      <div v-if="turn.isStreaming" class="va-console__streaming-indicator">
        <span class="va-console__cursor-dot" />
        <span>Agent 正在分析中…</span>
      </div>
      <!-- TASK-054：中止控制事件徽标（aborted 事件驱动，不再注入假正文） -->
      <div
        v-if="turn.abortedReason"
        class="va-console__abort-badge"
        :title="`中止成因：${abortReasonLabel}`"
      >
        ⏹ 任务已中止<template v-if="abortReasonLabel">（{{ abortReasonLabel }}）</template>
      </div>
    </div>
  </div>
</template>
