<script setup lang="ts">
import { computed } from "vue";
import { Bot } from "lucide-vue-next";
import { VaMarkdown } from "../markdown";
import { VaThoughtBox } from "../thought-box";
import { VaMessageActions } from "../message-actions";
import type { ActionCardItem, AssistantTurnEvents, AssistantTurnProps, TurnBlockItem } from "./types";

const props = withDefaults(defineProps<AssistantTurnProps>(), {
  content: "",
  thought: "",
  thoughtExpanded: true,
  thoughtDuration: undefined,
  processCollapsed: false,
  canCollapseProcess: false,
  toolCount: 0,
  streaming: false,
  avatar: "bot",
  aborted: false,
  abortReason: "",
  blocks: () => [],
  cards: () => [],
  actionsEnabled: true,
});

const emit = defineEmits<AssistantTurnEvents>();

const cardMap = computed<Record<string, ActionCardItem>>(() => {
  const map: Record<string, ActionCardItem> = {};
  for (const c of props.cards || []) {
    map[c.id] = c;
  }
  return map;
});

const displayBlocks = computed<TurnBlockItem[]>(() => {
  if (props.blocks && props.blocks.length > 0) {
    return props.blocks;
  }
  const blocks: TurnBlockItem[] = [];
  if (props.content) {
    blocks.push({ kind: "text", content: props.content });
  }
  for (const c of props.cards || []) {
    blocks.push({ kind: "card", cardId: c.id });
  }
  return blocks;
});

const hasThought = computed(() => Boolean(props.thought) || (props.streaming && !props.content));
</script>

<template>
  <div class="va-assistant-turn-row">
    <div class="va-assistant-turn">
      <!-- 1. 头像 -->
      <slot name="avatar">
        <div class="va-assistant-turn__avatar">
          <img v-if="props.avatar && props.avatar.startsWith('http')" :src="props.avatar" alt="Agent" />
          <Bot v-else-if="props.avatar === 'bot'" :size="18" />
          <span v-else>{{ props.avatar || "A" }}</span>
        </div>
      </slot>

      <div class="va-assistant-turn__body">
        <!-- 2. 思考过程 / 过程摘要折叠盒 -->
        <slot
          name="thought"
          :thought="props.thought"
          :expanded="props.thoughtExpanded"
          :summary-mode="props.processCollapsed"
        >
          <VaThoughtBox
            v-if="hasThought"
            :thought="props.thought"
            :expanded="props.thoughtExpanded"
            :duration="props.thoughtDuration"
            :streaming="props.streaming && !props.content"
            :summary-mode="props.processCollapsed"
            :tool-count="props.toolCount"
            @update:expanded="(val) => emit('update:thoughtExpanded', val)"
            @update:summary-mode="(val) => emit('update:processCollapsed', val)"
          />
        </slot>

        <!-- 3. 时序交错正文与动作卡片 -->
        <template v-for="(block, idx) in displayBlocks" :key="`${block.kind}-${idx}`">
          <!-- 文本 Markdown 渲染 -->
          <div v-if="block.kind === 'text' && block.content" class="va-assistant-turn__text">
            <VaMarkdown
              :content="block.content"
              :streaming="props.streaming && idx === displayBlocks.length - 1"
            />
          </div>

          <!-- 卡片插槽（如工具调用卡片、审批卡片） -->
          <div
            v-else-if="!props.processCollapsed && block.kind === 'card' && block.cardId"
            class="va-assistant-turn__card-container"
          >
            <slot
              name="card"
              :card-id="block.cardId"
              :card="cardMap[block.cardId]"
              :streaming="props.streaming"
            />
          </div>
        </template>

        <!-- 额外卡片/自定义业务组件扩展插槽 -->
        <slot />
        <slot name="extra" />

        <!-- 4. 底部消息操作条（输出完成且有正文时可用） -->
        <div v-if="props.actionsEnabled && !props.streaming && props.content" class="va-assistant-turn__actions">
          <slot name="actions" :content="props.content">
            <VaMessageActions
              :text="props.content"
              quiet
              @regenerate="emit('regenerate')"
              @copy="(t) => emit('copy', t || props.content || '')"
              @feedback="(k, r) => emit('feedback', k, r)"
            />
          </slot>
        </div>

        <!-- 5. 流式输出指示器 -->
        <div v-if="props.streaming" class="va-assistant-turn__streaming">
          <span class="va-assistant-turn__cursor-dot" />
          <span><slot name="streaming-label">Agent 正在分析中…</slot></span>
        </div>

        <!-- 6. 任务中止徽标 -->
        <div v-if="props.aborted" class="va-assistant-turn__aborted" :title="props.abortReason">
          <slot name="aborted-label" :reason="props.abortReason">
            ⏹ 任务已中止<template v-if="props.abortReason">（{{ props.abortReason }}）</template>
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style src="./VaAssistantTurn.css"></style>
