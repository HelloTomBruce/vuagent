<script setup lang="ts">
import { useTemplateRef, ref, watch } from "vue";
import type { TerminalLogEvents, TerminalLogProps } from "./types";
import { useTerminalLog } from "./useTerminalLog";
import { useCopyable } from "../../composables/useCopyable";

const props = withDefaults(defineProps<TerminalLogProps>(), { autoScroll: true });

const emit = defineEmits<TerminalLogEvents>();

const bodyEl = useTemplateRef<HTMLElement>("body");
const { rows, spans, plainText, onScroll } = useTerminalLog(props, bodyEl);

/** 行级复制：每次点击目标不同，复制状态共用一个 copiedIdx */
const copiedIdx = ref<number | null>(null);
const { copied, copy } = useCopyable(() => (copiedIdx.value !== null ? plainText(copiedIdx.value) : ""));
watch(copied, (v) => {
  if (v && copiedIdx.value !== null) emit("copy", plainText(copiedIdx.value));
});

function copyRow(i: number, e: Event) {
  e.stopPropagation();
  copiedIdx.value = i;
  copy();
}

const spanStyle = (fg?: string, bg?: string) => ({
  color: fg,
  backgroundColor: bg,
});
</script>

<template>
  <figure class="va-term">
    <header class="va-term__head">
      <span class="va-term__dots" aria-hidden="true"><i /><i /><i /></span>
      <span class="va-term__title">{{ props.title ?? "terminal" }}</span>
      <span class="va-term__spacer" />
      <span v-if="rows.length" class="va-term__count">{{ rows.length }} 行</span>
    </header>

    <div
      ref="body"
      class="va-term__body"
      :class="{ 'va-term__body--scroll': props.maxHeight }"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
      tabindex="0"
      role="log"
      :aria-label="`${props.title ?? '终端'}输出`"
      @scroll="onScroll"
    >
      <p v-if="!rows.length" class="va-term__empty">等待输出…</p>
      <div
        v-for="(row, i) in rows"
        :key="row.id"
        class="va-term__row"
        :data-kind="row.kind ?? 'out'"
      >
        <span v-if="props.showLineNumbers" class="va-term__no" aria-hidden="true">{{ i + 1 }}</span>
        <code class="va-term__code">
          <span
            v-for="(seg, si) in spans[i]"
            :key="si"
            :style="spanStyle(seg.color, seg.bgColor)"
            :class="{ 'va-term__b': seg.bold, 'va-term__i': seg.italic, 'va-term__u': seg.underline, 'va-term__dim': seg.dim }"
          >{{ seg.text }}</span>
        </code>
        <button
          class="va-term__copy"
          type="button"
          :aria-label="`复制第 ${i + 1} 行`"
          @click="copyRow(i, $event)"
        >
          {{ copied && copiedIdx === i ? "✓" : "⧉" }}
        </button>
      </div>
    </div>
  </figure>
</template>

<style src="./VaTerminalLog.css"></style>
