<script setup lang="ts">
/**
 * 固定在输入框上方的任务执行计划条 (VaAgentPlan 包装)
 * 支持折叠/展开，计划步骤由流事件全量同步
 */
import { ChevronDown, ChevronUp, ListTodo, Loader2 } from "lucide-vue-next";
import { VaAgentPlan } from "@vuagent/ui";
import type { PlanStep } from "../types";

defineProps<{
  steps: PlanStep[];
  completed: number;
  running?: PlanStep;
  expanded: boolean;
}>();

defineEmits<{ (e: "toggle"): void }>();
</script>

<template>
  <div class="va-console__docked-plan">
    <div class="va-console__plan-bar" @click="$emit('toggle')">
      <div class="va-console__plan-bar-left">
        <ListTodo :size="15" class="va-console__plan-icon" />
        <span class="va-console__plan-title">
          任务执行计划 ({{ completed }}/{{ steps.length }} 完成)
        </span>
        <span v-if="running" class="va-console__plan-active-chip">
          <Loader2 :size="11" class="va-console__spin" />
          正在执行: {{ running.title }}
        </span>
      </div>

      <div class="va-console__plan-bar-right">
        <span class="va-console__plan-toggle-label">{{ expanded ? "折叠" : "展开详情" }}</span>
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronUp v-else :size="14" />
      </div>
    </div>

    <!-- 计划展开抽屉（grid-rows 高度过渡折叠，clip 层裁剪） -->
    <Transition name="va-drawer-fold">
      <div v-if="expanded" class="va-console__plan-drawer">
        <div class="va-console__plan-drawer-clip">
          <VaAgentPlan :steps="steps" />
        </div>
      </div>
    </Transition>
  </div>
</template>
