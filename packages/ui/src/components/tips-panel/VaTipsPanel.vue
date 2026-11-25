<script setup lang="ts">
import { Lightbulb } from "lucide-vue-next";
import { useStagger } from "../../composables/useStagger";
import type { TipsPanelEvents, TipsPanelProps } from "./types";

const props = defineProps<TipsPanelProps>();

const emit = defineEmits<TipsPanelEvents>();

/**
 * 条目错峰（TASK-108）：统一消费 useStagger（animation-delay 轴，配合 .va-enter-*
 * 动画类使用；默认档位对齐 --va-stagger 40ms 步长、8 档钳制、reduced-motion 归零；
 * SSR 无 window 按正常分支输出，服务端与客户端首帧一致）。
 */
const { delayStyle } = useStagger();
</script>

<template>
  <aside v-if="tips.length" class="va-tips" aria-label="使用技巧">
    <header class="va-tips__head">
      <span class="va-tips__icon" aria-hidden="true"><Lightbulb :size="14" /></span>
      <span class="va-tips__title">{{ props.title ?? "使用技巧" }}</span>
    </header>
    <ul class="va-tips__list">
      <li
        v-for="(t, i) in tips"
        :key="t.id"
        class="va-tips__item va-enter-up"
        :style="delayStyle(i)"
      >
        <div class="va-tips__main">
          <span class="va-tips__t">{{ t.title }}</span>
          <span class="va-tips__b">{{ t.body }}</span>
        </div>
        <button
          v-if="props.dismissible"
          class="va-tips__close"
          type="button"
          :aria-label="`关闭技巧：${t.title}`"
          @click="emit('dismiss', t.id)"
        >×</button>
      </li>
    </ul>
  </aside>
  <p v-else-if="props.emptyLabel" class="va-tips__empty">{{ props.emptyLabel }}</p>
</template>

<style src="./VaTipsPanel.css"></style>
