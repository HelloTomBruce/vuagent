<script setup lang="ts">
import { computed } from "vue";
import type { CodeDiffEvents, CodeDiffProps } from "./types";
import { useCodeDiff } from "./useCodeDiff";
import { useCopyable } from "../../composables/useCopyable";
import type { InlineSegment, LineDiffRow } from "../../utils/lineDiff";

const props = withDefaults(defineProps<CodeDiffProps>(), { wordLevel: true, layout: "unified" });

const emit = defineEmits<CodeDiffEvents>();

const { render, stats, hasCollapsed, expandAll, toggleExpand, empty, rows, inline } = useCodeDiff(props);

const { copied, copy } = useCopyable(() => props.newText, (t) => emit("copy", t));

const signOf = (t: string) => (t === "add" ? "+" : t === "del" ? "−" : "");

/* ---------- 并排布局（layout="side"）：del/add 块按行配对成双列，无上下文折叠 ---------- */
interface SideCell {
  no?: number;
  text: string;
  segs?: InlineSegment[];
}
interface SidePair {
  type: "eq" | "del" | "add" | "pair";
  left?: SideCell;
  right?: SideCell;
}

const sidePairs = computed<SidePair[]>(() => {
  if (props.layout !== "side") return [];
  const rs: LineDiffRow[] = rows.value;
  const il = inline.value;
  const out: SidePair[] = [];
  let i = 0;
  const cell = (r: LineDiffRow, idx: number): SideCell => {
    const seg = il[idx];
    if (r.type === "del" && seg) return { no: r.oldNo, text: r.text, segs: seg.del };
    if (r.type === "add" && seg) return { no: r.newNo, text: r.text, segs: seg.add };
    return { no: (r.oldNo ?? r.newNo), text: r.text };
  };
  while (i < rs.length) {
    if (rs[i]!.type === "same") {
      out.push({ type: "eq", left: cell(rs[i]!, i), right: cell(rs[i]!, i) });
      i++;
      continue;
    }
    const delStart = i;
    while (i < rs.length && rs[i]!.type === "del") i++;
    const delEnd = i;
    const addStart = i;
    while (i < rs.length && rs[i]!.type === "add") i++;
    const addEnd = i;
    const dcount = delEnd - delStart;
    const acount = addEnd - addStart;
    const pairs = Math.max(dcount, acount);
    for (let k = 0; k < pairs; k++) {
      const dIdx = delStart + k;
      const aIdx = addStart + k;
      out.push({
        type: dIdx < delEnd && aIdx < addEnd ? "pair" : dIdx < delEnd ? "del" : "add",
        left: dIdx < delEnd ? cell(rs[dIdx]!, dIdx) : undefined,
        right: aIdx < addEnd ? cell(rs[aIdx]!, aIdx) : undefined,
      });
    }
  }
  return out;
});
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
        class="va-act va-act--sm va-cdiff__btn"
        type="button"
        :aria-pressed="expandAll"
        @click="expandAll = !expandAll"
      >
        {{ expandAll ? "折叠上下文" : "全部展开" }}
      </button>
      <button class="va-act va-act--sm va-cdiff__btn" type="button" :aria-label="copied ? '已复制' : '复制新文件内容'" @click="copy">
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
      <!-- 并排双列（layout="side"）：无折叠，del/add 配对 -->
      <div v-if="!empty && props.layout === 'side'" class="va-cdiff__side">
        <div
          v-for="(p, i) in sidePairs"
          :key="i"
          class="va-cdiff__srow"
          :data-type="p.type"
        >
          <span class="va-cdiff__no" aria-hidden="true">{{ p.left?.no ?? "" }}</span>
          <code class="va-cdiff__code va-cdiff__code--half" :data-side="p.left ? 'old' : 'empty'">
            <template v-if="p.left?.segs">
              <span v-for="(seg, si) in p.left.segs" :key="si" class="va-cdiff__seg" :data-kind="seg.kind">{{ seg.text }}</span>
            </template>
            <template v-else>{{ p.left?.text ?? "" }}</template>
          </code>
          <span class="va-cdiff__no" aria-hidden="true">{{ p.right?.no ?? "" }}</span>
          <code class="va-cdiff__code va-cdiff__code--half" :data-side="p.right ? 'new' : 'empty'">
            <template v-if="p.right?.segs">
              <span v-for="(seg, si) in p.right.segs" :key="si" class="va-cdiff__seg" :data-kind="seg.kind">{{ seg.text }}</span>
            </template>
            <template v-else>{{ p.right?.text ?? "" }}</template>
          </code>
        </div>
      </div>
      <template v-if="!empty && props.layout !== 'side'" v-for="(r, i) in render" :key="i">
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
