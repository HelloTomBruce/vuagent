<script setup lang="ts">
import type { ContextPart, ContextWindowProps } from "./types";
import { CONTEXT_KIND_LABEL } from "./types";
import { useContextWindow } from "./useContextWindow";
import { formatTokens } from "../../utils/format";

const props = withDefaults(defineProps<ContextWindowProps>(), {
  compacting: false,
  removable: true,
});

const emit = defineEmits<{ remove: [part: ContextPart]; compact: [] }>();

const { used, percent, hasHistory, shrinking, widthOf, legendKinds } = useContextWindow(props);
</script>

<template>
  <div class="va-ctx" :class="{ 'va-ctx--compacting': props.compacting }" role="img" :aria-label="`上下文已用 ${formatTokens(used)} / ${formatTokens(props.capacity)}`">
    <header class="va-ctx__head">
      <span class="va-ctx__used">
        <strong>{{ formatTokens(used) }}</strong> / {{ formatTokens(props.capacity) }}
      </span>
      <span class="va-ctx__pct">{{ Math.round(percent) }}%</span>
      <button
        class="va-btn va-btn--sm va-ctx__compact"
        type="button"
        :disabled="props.compacting || !hasHistory"
        @click="emit('compact')"
      >
        {{ props.compacting ? "压缩中…" : "压缩对话" }}
      </button>
    </header>

    <div class="va-ctx__bar" aria-hidden="true">
      <div
        v-for="p in props.parts"
        :key="p.id"
        class="va-ctx__cell"
        :data-kind="p.kind"
        :data-shrink="shrinking(p) || undefined"
        :style="{ width: widthOf(p) }"
        tabindex="0"
      >
        <button
          v-if="props.removable && p.kind === 'file'"
          class="va-ctx__remove"
          type="button"
          :aria-label="`移除 ${p.label}`"
          @click.stop="emit('remove', p)"
          @keydown.enter.stop="emit('remove', p)"
        >×</button>
        <span class="va-ctx__tip">
          <strong>{{ p.label }}</strong>
          <em>{{ CONTEXT_KIND_LABEL[p.kind] }} · {{ formatTokens(p.tokens) }} tokens</em>
        </span>
      </div>
    </div>

    <footer class="va-ctx__legend">
      <span v-for="k in legendKinds" :key="k" class="va-ctx__legend-item">
        <i :data-kind="k" />{{ CONTEXT_KIND_LABEL[k] }}
      </span>
    </footer>
  </div>
</template>

<style src="./VaContextWindow.css"></style>
