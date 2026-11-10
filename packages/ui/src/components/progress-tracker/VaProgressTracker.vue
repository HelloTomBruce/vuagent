<script setup lang="ts">
import { computed } from "vue";
import type { ProgressTrackerEvents, ProgressTrackerProps, TrackerStepStatus } from "./types";

const props = defineProps<ProgressTrackerProps>();

const emit = defineEmits<ProgressTrackerEvents>();

const statusOf = (i: number): TrackerStepStatus => {
  const s = props.steps[i]!.status;
  if (s) return s;
  const cur = props.current ?? 0;
  if (i < cur) return "done";
  if (i === cur) return "current";
  return "pending";
};

/** 完成比例（连接线填充），0-1 */
const ratio = computed(() => {
  const n = props.steps.length - 1;
  if (n <= 0) return 0;
  const doneCount = props.steps.filter((_, i) => statusOf(i) === "done").length;
  return doneCount / n;
});
</script>

<template>
  <ol
    class="va-pt"
    :data-orientation="props.orientation ?? 'horizontal'"
    :style="ratio ? { '--va-pt-fill': `${ratio * 100}%` } : { '--va-pt-fill': '0%' }"
  >
    <li
      v-for="(s, i) in props.steps"
      :key="i"
      class="va-pt__step"
      :data-status="statusOf(i)"
    >
      <button class="va-pt__node" type="button" :aria-current="statusOf(i) === 'current' ? 'step' : undefined" @click="emit('select', i)">
        <span class="va-pt__dot" aria-hidden="true">
          <template v-if="statusOf(i) === 'done'">✓</template>
          <template v-else-if="statusOf(i) === 'error'">!</template>
        </span>
        <span class="va-pt__label">{{ s.label }}</span>
      </button>
    </li>
  </ol>
</template>

<style src="./VaProgressTracker.css"></style>
