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
  <div class="va-turn-list">
    <div v-if="!props.turns.length" class="va-turn-list__empty">
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
