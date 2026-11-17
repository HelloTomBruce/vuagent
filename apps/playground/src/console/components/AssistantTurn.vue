<script setup lang="ts">
/**
 * 助手消息 Turn：思考折叠区 + 输出时序块(文本/卡片交错) + 消息操作 + 流式指示器
 * turn 为 reactive 代理对象，thoughtExpanded 原地切换（与原实现一致）
 * 三泳道轨迹（turn.trajEvents）不再内联渲染，由右侧边栏轨迹 tab 聚合展示
 */
import { computed } from "vue";
import { Bot, Brain, ChevronDown, ChevronUp } from "lucide-vue-next";
import { VaMessageActions } from "@vuagent/ui";
import CardRenderer from "./CardRenderer.vue";
import { renderMarkdown } from "../utils/markdown";
import type { ActionCard, MessageTurn, TurnBlock } from "../types";

const props = defineProps<{ turn: MessageTurn }>();

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
      <!-- 1. 思考过程 (折叠/展开) -->
      <div v-if="turn.thought || (turn.isStreaming && !turn.content)" class="va-console__thought-box">
        <div class="va-console__thought-header" @click="turn.thoughtExpanded = !turn.thoughtExpanded">
          <div class="va-console__thought-title">
            <Brain :size="14" class="va-console__pulse-icon" />
            <span>思考过程</span>
            <small v-if="turn.thoughtDuration">· 耗时 {{ turn.thoughtDuration }}s</small>
            <small v-else-if="turn.isStreaming">· 正在深度思考…</small>
          </div>
          <button class="va-console__thought-toggle-btn" type="button">
            {{ turn.thoughtExpanded ? "收起" : "展开" }}
            <ChevronUp v-if="turn.thoughtExpanded" :size="13" />
            <ChevronDown v-else :size="13" />
          </button>
        </div>

        <div v-if="turn.thoughtExpanded" class="va-console__thought-content">
          <pre>{{ turn.thought || "正在拆解任务意图，规划工具调用序列与沙箱执行路径…" }}</pre>
        </div>
      </div>

      <!-- 2. 输出时序块：文本(Markdown)与卡片按真实输出顺序交错，审批卡不再堆在消息末尾 -->
      <template v-for="(block, bi) in displayBlocks" :key="`${block.kind}-${bi}`">
        <div v-if="block.kind === 'text' && block.content" class="va-console__markdown-content">
          <div
            class="va-console__text-body va-console__markdown-body"
            v-html="renderMarkdown(block.content)"
          />
        </div>

        <div v-else-if="block.kind === 'card' && cardById[block.cardId]" class="va-console__action-cards">
          <CardRenderer
            :card="cardById[block.cardId]"
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
    </div>
  </div>
</template>
