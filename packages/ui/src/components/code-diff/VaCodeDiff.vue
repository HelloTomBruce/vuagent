<script setup lang="ts">
import type { CodeDiffEvents, CodeDiffProps } from "./types";
import { useCodeDiff } from "./useCodeDiff";
import { useCopyable } from "../../composables/useCopyable";

const props = defineProps<CodeDiffProps>();

const emit = defineEmits<CodeDiffEvents>();

const { render, stats, hasCollapsed, expandAll, toggleExpand, empty } = useCodeDiff(props);

const { copied, copy } = useCopyable(() => props.newText, (t) => emit("copy", t));

const signOf = (t: string) => (t === "add" ? "+" : t === "del" ? "−" : "");
</script>

<template>
  <figure class="va-cdiff">
    <header class="va-cdiff__head">
      <span v-if="props.fileName" class="va-cdiff__file">{{ props.fileName }}</span>
      <span class="va-cdiff__stats" role="status">
        <template v-if="!empty">+{{ stats.additions }} −{{ stats.deletions }}</template>
        <template v-else>无变更</template>
      </span>
      <span class="va-cdiff__spacer" />
      <button
        v-if="hasCollapsed"
        class="va-cdiff__btn"
        type="button"
        :aria-pressed="expandAll"
        @click="expandAll = !expandAll"
      >
        {{ expandAll ? "折叠上下文" : "全部展开" }}
      </button>
      <button class="va-cdiff__btn" type="button" :aria-label="copied ? '已复制' : '复制新文件内容'" @click="copy">
        {{ copied ? "已复制 ✓" : "复制新文件" }}
      </button>
    </header>

    <div
      class="va-cdiff__body"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
      tabindex="0"
      role="region"
      :aria-label="`代码差异${props.fileName ? `：${props.fileName}` : ''}`"
    >
      <p v-if="empty" class="va-cdiff__empty">两个版本内容一致。</p>
      <template v-for="(r, i) in render" :key="i">
        <div v-if="r.kind === 'row'" class="va-cdiff__row" :data-type="r.row.type">
          <span class="va-cdiff__no" aria-hidden="true">{{ r.row.oldNo ?? "" }}</span>
          <span class="va-cdiff__no" aria-hidden="true">{{ r.row.newNo ?? "" }}</span>
          <span class="va-cdiff__sign" aria-hidden="true">{{ signOf(r.row.type) }}</span>
          <code class="va-cdiff__code">
            <template v-if="r.inline">
              <span
                v-for="(seg, si) in r.row.type === 'del' ? r.inline.del : r.inline.add"
                :key="si"
                class="va-cdiff__seg"
                :data-seg="seg.kind"
              >{{ seg.text }}</span>
            </template>
            <template v-else>{{ r.row.text }}</template>
          </code>
        </div>
        <button
          v-else
          class="va-cdiff__expand"
          type="button"
          :aria-expanded="false"
          :title="`展开第 ${r.from}–${r.to} 行`"
          @click="toggleExpand(r)"
        >
          ⋯ 展开隐藏的 {{ r.count }} 行
        </button>
      </template>
    </div>
  </figure>
</template>

<style src="./VaCodeDiff.css"></style>
