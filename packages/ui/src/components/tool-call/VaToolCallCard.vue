<script setup lang="ts">
import type { ToolCallCardProps } from "./types";
import { useToolCallCard } from "./useToolCallCard";

const props = withDefaults(defineProps<ToolCallCardProps>(), {
  summary: undefined,
  args: undefined,
  result: undefined,
  error: undefined,
  startedAt: undefined,
  duration: undefined,
  maxCodeHeight: 220,
  openOnError: true,
  defaultOpen: false,
  open: undefined,
});

const emit = defineEmits<{ retry: []; "update:open": [v: boolean] }>();

const { id, isOpen, timeLabel, argsText, resultText, expanded, isLong, toggle } = useToolCallCard(props, (v) =>
  emit("update:open", v),
);
</script>

<template>
  <div class="va-tcl" :class="[`va-tcl--${props.status}`, isOpen ? 'va-tcl--open' : '']" :data-status="props.status">
    <button :id="id" class="va-tcl__head" type="button" :aria-expanded="isOpen" @click="toggle">
      <span class="va-tcl__tile" :data-status="props.status">
        <slot name="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14.7 6.3a4.6 4.6 0 0 0-6.16 5.44L3.4 16.9a2 2 0 1 0 2.83 2.83l5.16-5.16a4.6 4.6 0 0 0 5.44-6.16l-2.6 2.6-2.3-.62-.62-2.3 2.6-2.6Z" />
          </svg>
        </slot>
        <span v-if="props.status === 'running'" class="va-tcl__spin" aria-hidden="true" />
      </span>
      <span class="va-tcl__meta">
        <code class="va-tcl__name">{{ props.name }}</code>
        <span v-if="props.summary" class="va-tcl__summary">{{ props.summary }}</span>
      </span>
      <span class="va-tcl__side">
        <span class="va-tcl__time">{{ timeLabel }}</span>
        <svg v-if="props.status === 'success'" class="va-tcl__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M5.5 12.5l4 4L18.5 8" />
        </svg>
        <svg v-else-if="props.status === 'error'" class="va-tcl__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5M12 16h.01" />
        </svg>
        <svg class="va-tcl__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="m9.5 7 5 5-5 5" />
        </svg>
      </span>
    </button>

    <div class="va-tcl__body" role="region" :aria-label="`${props.name} 详情`">
      <div class="va-tcl__inner">
        <div v-if="props.error" class="va-tcl__error">
          <span class="va-tcl__error-text">{{ props.error }}</span>
          <button class="va-act va-act--sm va-act--danger va-tcl__retry" type="button" @click="emit('retry')">↻ 重试</button>
        </div>
        <section v-if="argsText" class="va-tcl__sec">
          <h4 class="va-tcl__sec-title">参数</h4>
          <pre
            class="va-tcl__code"
            :class="{ 'va-tcl__code--capped': isLong(argsText) && !expanded.args }"
            :style="expanded.args || !isLong(argsText) ? undefined : { maxHeight: `${props.maxCodeHeight}px` }"
          >{{ argsText }}</pre>
          <button v-if="isLong(argsText)" class="va-tcl__more" type="button" @click="expanded.args = !expanded.args">
            {{ expanded.args ? "收起" : "显示全部" }}
          </button>
        </section>
        <section v-if="resultText" class="va-tcl__sec">
          <h4 class="va-tcl__sec-title">结果</h4>
          <pre
            class="va-tcl__code"
            :class="{ 'va-tcl__code--capped': isLong(resultText) && !expanded.result }"
            :style="expanded.result || !isLong(resultText) ? undefined : { maxHeight: `${props.maxCodeHeight}px` }"
          >{{ resultText }}</pre>
          <button v-if="isLong(resultText)" class="va-tcl__more" type="button" @click="expanded.result = !expanded.result">
            {{ expanded.result ? "收起" : "显示全部" }}
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<style src="./VaToolCallCard.css"></style>
