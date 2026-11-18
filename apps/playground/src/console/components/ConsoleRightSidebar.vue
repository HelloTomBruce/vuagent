<script setup lang="ts">
/**
 * 右侧边栏：跨会话 HITL 待审批收件箱
 * （轨迹视图已迁入消息区顶部「对话 / 轨迹」tab——侧栏宽度不适合宽幅台账，见 Console.vue）
 */
import { PanelRight } from "lucide-vue-next";
import { VaDecisionInbox } from "@vuagent/ui";
import type { Decision } from "@vuagent/ui";

defineProps<{
  /** 跨会话待审批决策 */
  decisions: Decision[];
}>();

const emit = defineEmits<{
  (e: "collapse"): void;
  (e: "decide", decision: Decision, answer: "primary" | "secondary"): void;
}>();
</script>

<template>
  <aside class="va-console__right-sidebar">
    <!-- 侧栏头 -->
    <div class="va-console__rtabs">
      <button class="va-console__rtab va-console__rtab--active" type="button">
        审批
        <span
          v-if="decisions.length > 0"
          class="va-console__rtab-badge"
        >{{ decisions.length }}</span>
      </button>
      <button
        class="va-console__rtab-collapse"
        type="button"
        title="收起侧栏"
        @click="emit('collapse')"
      >
        <PanelRight :size="14" />
      </button>
    </div>

    <!-- 待审批收件箱 -->
    <div class="va-console__rtab-body">
      <VaDecisionInbox
        v-if="decisions.length > 0"
        :decisions="decisions"
        @decide="(d, a) => emit('decide', d, a)"
      />
      <div v-else class="va-console__rtab-empty">
        <PanelRight :size="20" />
        <p>没有待审批的操作</p>
        <small>各会话的高风险工具请求会汇总到这里</small>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.va-console__rtab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: default;
}

.va-console__rtab-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--va-danger, #d5453c);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
