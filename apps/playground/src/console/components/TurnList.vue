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
          <!-- 附件回显（TASK-050）：当日真图 / 历史占位 / 文本附件 chip -->
          <div v-if="turn.attachments?.length" class="va-console__user-atts">
            <template v-for="att in turn.attachments" :key="att.name + att.size">
              <a
                v-if="att.kind === 'image' && att.dataUrl"
                :href="att.dataUrl"
                target="_blank"
                rel="noopener"
                class="va-console__user-att-img-link"
                :title="`${att.name}（点击新窗口查看原图）`"
              >
                <img :src="att.dataUrl" :alt="att.name" class="va-console__user-att-img" />
              </a>
              <span
                v-else
                class="va-console__user-att-chip"
                :title="att.size ? `${att.name} · ${att.size} B` : att.name"
              >{{ att.kind === "image" ? `[图] ${att.name}` : `[附件] ${att.name}` }}</span>
            </template>
          </div>
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
