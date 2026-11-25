<script setup lang="ts">
import { ref } from "vue";
import type { SmartRecommendationEvents, SmartRecommendationProps } from "./types";

const props = withDefaults(defineProps<SmartRecommendationProps>(), { dismissible: true });

const emit = defineEmits<SmartRecommendationEvents>();

/**
 * 反馈过渡（TASK-107）：点击接受/忽略即记 acted 态并立刻 emit（宿主去留不受阻）；
 * 卡片转暗、对应按钮淡出、spark spring 弹一下（视觉确认，见 CSS 段注释）。
 */
const actedId = ref<string | null>(null);
function act(id: string) {
  actedId.value = id;
  emit("action", id);
}
function dismiss() {
  actedId.value = "dismiss";
  emit("dismiss");
}
</script>

<template>
  <!-- 入场（TASK-107）：.va-enter-up（motion.css 统一协议，180ms 上浮+fade） -->
  <aside class="va-rec va-enter-up" role="note" aria-label="agent 建议" :data-acted="actedId ? 'true' : undefined">
    <span class="va-rec__spark" aria-hidden="true">✦</span>
    <div class="va-rec__main">
      <header class="va-rec__head">
        <span class="va-rec__title">{{ props.title }}</span>
        <span v-if="props.impact" class="va-rec__impact">{{ props.impact }}</span>
      </header>
      <p v-if="props.description" class="va-rec__desc">{{ props.description }}</p>
      <footer class="va-rec__ops">
        <button
          v-for="a in props.actions"
          :key="a.id"
          class="va-act va-act--sm va-rec__btn"
          type="button"
          :data-primary="a.primary ?? false"
          :data-acted="actedId === a.id ? 'true' : undefined"
          @click="act(a.id)"
        >{{ a.label }}</button>
      </footer>
    </div>
    <button
      v-if="props.dismissible"
      class="va-rec__close"
      type="button"
      :aria-label="props.dismissLabel ?? '忽略此建议'"
      @click="dismiss"
    >×</button>
  </aside>
</template>

<style src="./VaSmartRecommendation.css"></style>
