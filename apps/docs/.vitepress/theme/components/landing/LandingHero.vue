<script setup lang="ts">
import { VaGridBackground, VaTextReveal, VaKpiChart } from "@vuagent/ui";
import { withBase } from "vitepress";
</script>

<template>
  <section class="lh-hero">
    <VaGridBackground class="lh-hero__bg" :size="46" :speed="1.6" direction="diagonal" :fade="55" />
    <div class="lh-hero__inner">
      <div class="lh-hero__copy">
        <span class="lh-hero__eyebrow">Vue 生态 · Agent Ops 工具箱 · v0.3.0 已发布 npm</span>
        <h1 class="lh-hero__title">
          <VaTextReveal text="给 Agent 一个真正的" as="span" :stagger="40" />
          <span class="lh-hero__title-accent">
            <VaTextReveal text="运行时操作层" as="span" :stagger="60" />
          </span>
        </h1>
        <p class="lh-hero__tagline">
          执行计划、危险操作审批、工具调用链、上下文水位、后台任务收件箱——<br />
          把埋在文本流里的 Agent 状态，变成用户看得见、管得住的界面。
        </p>
        <div class="lh-hero__ctas">
          <a class="lh-btn lh-btn--primary" :href="withBase('/guide/getting-started')">快速接入 Vue 项目</a>
          <a class="lh-btn" :href="withBase('/components/')">浏览 79 个组件</a>
          <a
            class="lh-btn lh-btn--ghost"
            href="https://github.com/HelloTomBruce/vuagent"
            target="_blank"
            rel="noreferrer"
          >GitHub</a>
        </div>
        <div class="lh-hero__kpis">
          <VaKpiChart label="运行时组件" :value="79" :series="[30, 38, 45, 52, 58, 66, 73, 79]" :width="150" :height="34" />
          <VaKpiChart label="SSE 契约事件" :value="18" :series="[8, 10, 12, 14, 16, 17, 18, 18]" :width="150" :height="34" />
          <VaKpiChart label="npm 三包版本" :value="0.3" :series="[1, 2, 3]" :width="150" :height="34" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-hero {
  position: relative;
  overflow: hidden;
  background: var(--va-ink, #1a1917);
}
.lh-hero__bg {
  position: absolute;
  inset: 0;
  opacity: 0.55;
}
.lh-hero__inner {
  position: relative;
  max-width: 1180px;
  margin: 0 auto;
  padding: 96px 32px 84px;
}
.lh-hero__eyebrow {
  display: inline-flex;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #e8925e;
  border: 1px solid rgba(232, 146, 94, 0.35);
  background: rgba(232, 146, 94, 0.08);
  border-radius: 999px;
  padding: 5px 14px;
}
.lh-hero__title {
  margin: 26px 0 0;
  font-size: 58px;
  line-height: 1.22;
  font-weight: 800;
  color: var(--ink-inverse, #f0eee9);
  letter-spacing: -0.01em;
}
.lh-hero__title-accent {
  color: var(--va-accent, #c2410c);
  background: linear-gradient(120deg, #c2410c 20%, #e8925e 90%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.lh-hero__tagline {
  margin: 24px 0 0;
  font-size: 19px;
  line-height: 1.85;
  color: rgba(240, 238, 233, 0.72);
}
.lh-hero__ctas {
  display: flex;
  gap: 14px;
  margin-top: 36px;
  flex-wrap: wrap;
}
.lh-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  padding: 11px 24px;
  border-radius: 10px;
  border: 1px solid rgba(240, 238, 233, 0.22);
  color: var(--ink-inverse, #f0eee9);
  text-decoration: none;
  transition: all 0.15s;
}
.lh-btn:hover { border-color: #e8925e; color: #e8925e; }
.lh-btn--primary {
  background: var(--va-accent, #c2410c);
  border-color: var(--va-accent, #c2410c);
  color: #ffffff;
}
.lh-btn--primary:hover { background: #d9531e; color: #ffffff; }
.lh-btn--ghost { border-style: dashed; }
.lh-hero__kpis {
  display: flex;
  gap: 22px;
  margin-top: 48px;
  flex-wrap: wrap;
}
@media (max-width: 960px) {
  .lh-hero__title { font-size: 40px; }
  .lh-hero__inner { padding: 72px 20px 64px; }
}
</style>
