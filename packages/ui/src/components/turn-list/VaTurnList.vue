<script setup lang="ts">
import { VaUserBubble } from "../user-bubble";
import { VaAssistantTurn } from "../assistant-turn";
import type { ActionCardItem } from "../assistant-turn/types";
import type { TurnListEvents, TurnListProps } from "./types";

const props = withDefaults(defineProps<TurnListProps>(), {
  turns: () => [],
  emptyText: "给 Agent 发送一条消息开始交互",
});

const emit = defineEmits<TurnListEvents>();
</script>

<template>
  <!-- TASK-103 过渡方案取舍（保守：仅入场、无 move/leave）：
       本列表是聊天主流的 v-for 追加场景，评估过分组过渡组件（进出 + FLIP move）后放弃——
       move 过渡期间节点带 transform 位移，与 stick-to-bottom 的 rAF 贴底跟随
       （composables/useStickToBottom.ts，按 scrollHeight 实时滚动）互相打架，长流式输出
       时滚动抖动；leave 过渡还会让被删节点延迟出流改变布局。对话流实际只增不删
       （clearMessages 为整体清空，无需过渡），故采用任务清单的保守方案：
       新轮次入场由子组件根节点（VaUserBubble / VaAssistantTurn 的 *-row）挂载
       .va-enter-up 一次性播放（重挂载重放口径），本组件不引入 move/leave 过渡。 -->
  <div class="va-turn-list">
    <div v-if="!props.turns.length" class="va-turn-list__empty va-fade-in">
      <slot name="empty">{{ props.emptyText }}</slot>
    </div>

    <template v-for="turn in props.turns" :key="turn.id">
      <!-- 用户消息轮次 -->
      <slot v-if="turn.role === 'user'" name="user-turn" :turn="turn">
        <VaUserBubble
          :content="turn.content"
          :attachments="turn.attachments"
          :avatar="turn.avatar"
        />
      </slot>

      <!-- 助手消息轮次 -->
      <slot v-else-if="turn.role === 'assistant'" name="assistant-turn" :turn="turn">
        <VaAssistantTurn
          :content="turn.content"
          :thought="turn.thought"
          :thought-expanded="turn.thoughtExpanded"
          :thought-duration="turn.thoughtDuration"
          :process-collapsed="turn.processCollapsed"
          :tool-count="turn.toolCount"
          :streaming="turn.streaming"
          :avatar="turn.avatar"
          :aborted="turn.aborted"
          :abort-reason="turn.abortReason"
          :blocks="turn.blocks"
          :cards="turn.cards"
          @regenerate="emit('regenerate', turn.id)"
          @copy="(t) => emit('copy', t, turn.id)"
          @feedback="(k, r) => emit('feedback', turn.id, k, r)"
          @update:thought-expanded="(val) => emit('updateThoughtExpanded', turn.id, val)"
          @update:process-collapsed="(val) => emit('updateProcessCollapsed', turn.id, val)"
        >
          <!-- 穿透卡片插槽 -->
          <template #card="{ cardId, card, streaming }">
            <slot
              name="card"
              :turn-id="turn.id"
              :card-id="cardId"
              :card="(card as ActionCardItem | undefined)"
              :streaming="streaming"
            />
          </template>
        </VaAssistantTurn>
      </slot>
    </template>
  </div>
</template>

<style src="./VaTurnList.css"></style>
