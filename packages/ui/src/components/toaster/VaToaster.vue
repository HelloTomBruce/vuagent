<script setup lang="ts">
import { watch } from "vue";
import type { ToasterProps } from "./types";
import { vaToaster } from "./store";

withDefaults(defineProps<ToasterProps>(), { position: "bottom-right" });

/**
 * 入场级联延迟按「同一批次新入场的条目序号」计算（0/40/80ms…封顶 320ms），
 * 不用 store 全量索引——store 是尾部追加语义，全量索引会让后来单条 toast
 * 背上历史累积延迟（堆 5 条后来第 6 条要白等 200ms+）。
 * Map 为非响应式：watch 默认 pre-flush 先于重渲染执行，新条目首帧即可读到值。
 */
const enterDelay = new Map<number, number>();
let prevIds = new Set<number>();

watch(
  () => vaToaster.state.toasts.map((t) => t.id),
  (ids) => {
    let batch = 0;
    for (const id of ids) {
      if (!prevIds.has(id)) {
        enterDelay.set(id, Math.min(batch, 8) * 40);
        batch++;
      }
    }
    prevIds = new Set(ids);
    for (const id of [...enterDelay.keys()]) {
      if (!prevIds.has(id)) enterDelay.delete(id); // 已离场条目的延迟记录随手清理
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="va-toast" :class="`va-toast--${position}`" aria-live="polite" role="status">
    <TransitionGroup name="va-toast">
      <div
        v-for="t in vaToaster.state.toasts"
        :key="t.id"
        class="va-toast__item"
        :data-kind="t.kind"
        :style="{ '--va-stagger': `${enterDelay.get(t.id) ?? 0}ms` }"
      >
        <span class="va-toast__icon" aria-hidden="true">
          <svg v-if="t.kind === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5.5 12.5l4 4L18.5 8" /></svg>
          <svg v-else-if="t.kind === 'danger'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></svg>
          <svg v-else-if="t.kind === 'warning'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 16.5h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
        </span>
        <div class="va-toast__body">
          <p class="va-toast__title">{{ t.title }}</p>
          <p v-if="t.description" class="va-toast__desc">{{ t.description }}</p>
        </div>
        <button class="va-toast__close" type="button" aria-label="关闭通知" @click="vaToaster.dismiss(t.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style src="./VaToaster.css"></style>
