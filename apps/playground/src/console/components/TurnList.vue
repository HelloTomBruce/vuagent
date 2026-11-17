<script setup lang="ts">
/**
 * 消息瀑布流：用户气泡 + 助手 Turn 列表
 * 滚动容器 (va-console__messages-stream) 保留在父级以便父级控制 scrollTop
 */
import { User } from "lucide-vue-next";
import AssistantTurn from "./AssistantTurn.vue";
import type { MessageTurn } from "../types";

defineProps<{ turns: MessageTurn[] }>();

defineEmits<{
  (e: "approve", actionId: string): void;
  (e: "deny", actionId: string, reason?: string): void;
  (e: "regenerate", turnId: string): void;
  (e: "feedback", kind: "up" | "down" | null, reason?: string): void;
}>();
</script>

<template>
  <template v-for="turn in turns" :key="turn.id">
    <!-- 用户消息气泡 -->
    <div v-if="turn.role === 'user'" class="va-console__turn-row">
      <div class="va-console__user-bubble-container">
        <div class="va-console__user-bubble">
          <p class="va-console__user-text">{{ turn.content }}</p>
        </div>
        <div class="va-console__user-avatar">
          <User :size="16" />
        </div>
      </div>
    </div>

    <!-- 助手消息与 Agent 操作流水 -->
    <div v-else class="va-console__turn-row">
      <AssistantTurn
        :turn="turn"
        @approve="(actionId) => $emit('approve', actionId)"
        @deny="(actionId, reason) => $emit('deny', actionId, reason)"
        @regenerate="(turnId) => $emit('regenerate', turnId)"
        @feedback="(kind, reason) => $emit('feedback', kind, reason)"
      />
    </div>
  </template>
</template>
