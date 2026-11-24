<script setup lang="ts">
import { Layers } from "lucide-vue-next";

export interface CopyVariantsProps {
  original?: string;
  variants?: Array<{ style: string; angle: string; text: string }>;
}

const props = withDefaults(defineProps<CopyVariantsProps>(), {
  original: "",
  variants: () => [],
});

/** 卡片内交互回传：点选变体 → 按该风格进入精修 diff */
const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

function pick(style: string) {
  const variant = props.variants.find((v) => v.style === style);
  emit("quick", `请调用 copy_polish 工具按「${style}」风格精修这段文案：${variant?.text || props.original}`);
}
</script>

<template>
  <div class="var-card">
    <div class="var-card__head">
      <Layers :size="15" />
      <div>
        <div class="var-card__title">三种风格变体</div>
        <div class="var-card__meta">点击任一变体卡片，agent 会按该风格生成可逐词采纳的精修 diff</div>
      </div>
    </div>

    <div class="var-grid">
      <button
        v-for="v in variants"
        :key="v.style"
        type="button"
        class="var-item"
        :class="`var-item--${v.style}`"
        @click="pick(v.style)"
      >
        <div class="var-item__head">
          <span class="var-item__style">{{ v.style }}</span>
          <span class="var-item__angle">{{ v.angle }}</span>
        </div>
        <p class="var-item__text">{{ v.text }}</p>
        <span class="var-item__cta">按此风格精修 →</span>
      </button>
    </div>

    <details v-if="original" class="var-card__origin">
      <summary>查看原文案</summary>
      <p>{{ original }}</p>
    </details>
  </div>
</template>

<style scoped>
.var-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.var-card__head { display: flex; align-items: flex-start; gap: 8px; }
.var-card__head svg { color: var(--gv-accent); margin-top: 2px; }
.var-card__title { font-size: 13px; font-weight: 600; }
.var-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }

.var-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.var-item {
  text-align: left; border: 1px solid var(--gv-border); background: #fff;
  border-radius: 10px; padding: 10px; cursor: pointer;
  display: flex; flex-direction: column; gap: 7px; transition: all 0.15s;
  font-family: inherit;
}
.var-item:hover { border-color: var(--gv-accent); box-shadow: 0 2px 10px rgba(194, 65, 12, 0.1); transform: translateY(-1px); }

.var-item__head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.var-item__style { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #fff1e7; color: var(--gv-accent); }
.var-item--克制 .var-item__style { background: #eef2f6; color: #475569; }
.var-item--口语化 .var-item__style { background: #ecfdf5; color: #047857; }
.var-item__angle { font-size: 9px; color: var(--gv-muted); }

.var-item__text { font-size: 11px; line-height: 1.7; color: var(--gv-ink); margin: 0; flex: 1; }
.var-item__cta { font-size: 10px; color: var(--gv-accent); font-weight: 600; }

.var-card__origin summary { font-size: 11px; color: var(--gv-muted); cursor: pointer; }
.var-card__origin p { font-size: 11px; color: var(--gv-muted); line-height: 1.7; margin: 6px 0 0; }

@media (max-width: 700px) {
  .var-grid { grid-template-columns: 1fr; }
}
</style>
