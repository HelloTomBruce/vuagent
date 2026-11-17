<script setup lang="ts">
/**
 * 右侧边栏：tab 容器（轨迹 / 审批 / 后续扩展更多 tab）
 * 对齐 dsh 侧栏形态：会话级聚合视图
 * - 轨迹 tab：三泳道台账 + 时间线（跨 turn 聚合）
 * - 审批 tab：跨会话 HITL 待审批收件箱（VaDecisionInbox）
 */
import { ref } from "vue";
import { ChevronRight, PanelRight } from "lucide-vue-next";
import { VaDecisionInbox, VaTrajectory } from "@vuagent/ui";
import type { Decision } from "@vuagent/ui";
import type { TrajEvent } from "../types";

const props = defineProps<{
  /** 会话级聚合轨迹（跨 turn，服务端事件自带 turn 编号） */
  trajEvents: TrajEvent[];
  /** 跨会话待审批决策 */
  decisions: Decision[];
}>();

const emit = defineEmits<{
  (e: "collapse"): void;
  (e: "decide", decision: Decision, answer: "primary" | "secondary"): void;
}>();

/** tab 注册表：新 tab 在此扩展 */
const tabs = [
  { id: "traj", label: "轨迹" },
  { id: "inbox", label: "审批" },
] as const;
const activeTab = ref<string>("traj");
</script>

<template>
  <aside class="va-console__right-sidebar">
    <!-- tab 头 -->
    <div class="va-console__rtabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="va-console__rtab"
        :class="{ 'va-console__rtab--active': activeTab === t.id }"
        type="button"
        @click="activeTab = t.id"
      >
        {{ t.label }}
        <span
          v-if="t.id === 'inbox' && props.decisions.length > 0"
          class="va-console__rtab-badge"
        >{{ props.decisions.length }}</span>
      </button>
      <button
        class="va-console__rtab-collapse"
        type="button"
        title="收起侧栏"
        @click="emit('collapse')"
      >
        <ChevronRight :size="14" />
      </button>
    </div>

    <!-- 轨迹 tab -->
    <div v-if="activeTab === 'traj'" class="va-console__rtab-body">
      <VaTrajectory
        v-if="props.trajEvents.length > 0"
        :events="props.trajEvents"
        :ledger-max-height="undefined"
      />
      <div v-else class="va-console__rtab-empty">
        <PanelRight :size="20" />
        <p>本轮会话还没有轨迹</p>
        <small>发送任务后，执行步骤将实时显示在这里</small>
      </div>
    </div>

    <!-- 审批 tab：跨会话待审批收件箱 -->
    <div v-else-if="activeTab === 'inbox'" class="va-console__rtab-body">
      <VaDecisionInbox
        v-if="props.decisions.length > 0"
        :decisions="props.decisions"
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
