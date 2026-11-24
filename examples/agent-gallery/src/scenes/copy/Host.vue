<script setup lang="ts">
import { PenLine, Sparkles } from "lucide-vue-next";

const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

const draft = `我们致力于打造行业领先的智能客服平台，通过非常强大的 AI 能力，为大家进行了全链路的服务体验提升和改进。平台支持多渠道接入，可以帮助您快速搭建属于自己的客服体系。`;
</script>

<template>
  <div>
    <div class="host-banner">
      <h1>内容精修台（Copy Studio）</h1>
      <p>agent 改稿不再是「整个替换」——行内 diff 让你可以逐词决定采纳还是保留原文，改稿权始终在你手里。</p>
    </div>

    <div class="draft-card">
      <div class="draft-card__head">
        <PenLine :size="14" />
        <span>草稿 · 产品发布文案 v3</span>
        <span class="draft-card__tag">待精修</span>
      </div>
      <p class="draft-card__body">{{ draft }}</p>
    </div>

    <button class="cta" @click="emit('quick', `请调用 copy_polish 工具，按「冲击力」风格精修这段文案：${draft}`)">
      <Sparkles :size="13" /> 让 agent 精修这段草稿
    </button>
  </div>
</template>

<style scoped>
.host-banner { margin-bottom: 14px; }
.host-banner h1 { font-size: 16px; margin: 0 0 4px; }
.host-banner p { font-size: 12px; color: var(--gv-muted); margin: 0; max-width: 640px; line-height: 1.6; }

.draft-card {
  background: #ffffff; border: 1px solid var(--gv-border);
  border-radius: 10px; padding: 14px; margin-bottom: 16px;
}
.draft-card__head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; margin-bottom: 10px; }
.draft-card__tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; background: #fff1e7; color: var(--gv-accent); }
.draft-card__body { font-size: 13px; line-height: 1.9; color: var(--gv-ink); margin: 0; }

.cta {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--gv-accent); background: #fff1e7; color: var(--gv-accent);
  font-size: 12px; font-weight: 600; padding: 8px 14px; border-radius: 8px; cursor: pointer;
}
.cta:hover { background: #ffe4d1; }
</style>
