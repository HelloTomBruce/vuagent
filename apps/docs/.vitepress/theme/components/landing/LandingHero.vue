<script setup lang="ts">
import { VaGridBackground, VaTextReveal, VaAgentPlan } from "@vuagent/ui";
import { withBase } from "vitepress";

const planSteps = [
  { id: "h1", title: "调用 ops_scale_replicas", detail: "order-service · 2 → 5 副本", status: "done", duration: 420 },
  { id: "h2", title: "等待人工审批", detail: "高风险写操作 · 安全引擎挂起", status: "running", startedAt: Date.now() - 3_200 },
  { id: "h3", title: "探针就绪检查", detail: "liveness / readiness 5/5", status: "pending" },
];
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
          执行计划、危险操作审批、表单采集、协作计划、工具调用链、上下文水位、后台任务收件箱——<br />
          把埋在文本流里的 Agent 状态，变成用户看得见、管得住的界面。
        </p>
        <div class="lh-hero__ctas">
          <a class="lh-btn lh-btn--primary" :href="withBase('/guide/getting-started')">快速接入 Vue 项目</a>
          <a class="lh-btn" :href="withBase('/components/')">浏览 83 个组件</a>
          <a
            class="lh-btn lh-btn--ghost"
            href="https://github.com/HelloTomBruce/vuagent"
            target="_blank"
            rel="noreferrer"
          >GitHub</a>
        </div>
        <div class="lh-hero__meta">
          <span>83 个运行时组件</span><i /><span>18 种 SSE 契约事件</span><i /><span>v0.3.0 · MIT</span>
        </div>
      </div>

      <!-- 签名演示：文本流 → 卡片流（真组件） -->
      <div class="lh-hero__demo" aria-label="文本流到组件流的转化演示">
        <div class="lh-hero__stream">
          <div class="lh-hero__stream-head">agent 文本流</div>
          <div class="lh-hero__stream-line">▸ 调用 ops_scale_replicas</div>
          <div class="lh-hero__stream-line">▸ service: order-service · replicas: 5</div>
          <div class="lh-hero__stream-line lh-hero__stream-line--dim">▸ suspended · 等待审批<span class="lh-hero__cursor">▍</span></div>
        </div>
        <div class="lh-hero__morph">
          <span class="lh-hero__morph-line"></span>
          <span class="lh-hero__morph-label">渲染分发器</span>
          <span class="lh-hero__morph-line"></span>
        </div>
        <div class="lh-hero__card">
          <div class="lh-hero__card-head">组件流 · 同一次调用</div>
          <VaAgentPlan :steps="(planSteps as any)" :editable="false" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-hero {
  /* 亮暗双主题：本地变量承载版块配色，.dark 祖先类翻转（与 tokens.css 的 .dark 块同机制） */
  --_bg: #f7f5f1;
  --_panel: #ffffff;
  --_ink: #1a1917;
  --_accent: #c2410c;
}
.dark .lh-hero {
  --_bg: #141311;
  --_panel: #1c1a17;
  --_ink: #f0eee9;
  --_accent: #e8925e;
}
.lh-hero {
  position: relative;
  overflow: hidden;
  background: var(--_bg);
}
.lh-hero__bg {
  position: absolute;
  inset: 0;
  opacity: 0.5;
}
.lh-hero__inner {
  position: relative;
  max-width: 1280px;
  margin: 0 auto;
  padding: 96px 32px 88px;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 64px;
  align-items: center;
}
.lh-hero__eyebrow {
  display: inline-flex;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--_accent);
  border: 1px solid color-mix(in srgb, var(--_accent) 35%, transparent);
  background: color-mix(in srgb, var(--_accent) 8%, transparent);
  border-radius: 999px;
  padding: 5px 14px;
}
.lh-hero__title {
  margin: 26px 0 0;
  font-size: 54px;
  line-height: 1.22;
  font-weight: 800;
  color: var(--_ink);
  letter-spacing: -0.01em;
}
.lh-hero__title-accent { color: var(--_accent); }
.lh-hero__tagline {
  margin: 24px 0 0;
  font-size: 18px;
  line-height: 1.85;
  color: color-mix(in srgb, var(--_ink) 74%, transparent);
}
.lh-hero__ctas {
  display: flex;
  gap: 14px;
  margin-top: 34px;
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
  border: 1px solid color-mix(in srgb, var(--_ink) 22%, transparent);
  color: var(--_ink);
  text-decoration: none;
  transition: all 0.15s;
}
.lh-btn:hover { border-color: var(--_accent); color: var(--_accent); }
.lh-btn--primary {
  background: var(--va-accent, #c2410c);
  border-color: var(--va-accent, #c2410c);
  color: var(--va-accent-contrast, #ffffff);
}
.lh-btn--primary:hover { background: var(--va-accent-hover, #d9531e); color: var(--va-accent-contrast, #ffffff); }
.lh-btn--ghost { border-style: dashed; }
.lh-hero__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 34px;
  font-size: 13px;
  color: color-mix(in srgb, var(--_ink) 66%, transparent);
  font-family: var(--va-font-mono, ui-monospace, monospace);
  flex-wrap: wrap;
}
.lh-hero__meta i {
  width: 4px; height: 4px; border-radius: 50%;
  background: color-mix(in srgb, var(--_ink) 30%, transparent);
}

/* ---- 变形演示面板 ---- */
.lh-hero__demo {
  background: var(--_panel);
  border: 1px solid color-mix(in srgb, var(--_accent) 22%, transparent);
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 0 0 1px rgba(194, 65, 12, 0.12), 0 30px 80px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.lh-hero__stream {
  background: #0b0f14;
  border-radius: 12px;
  padding: 14px 16px;
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 13px;
  line-height: 2;
}
.lh-hero__stream-head {
  font-size: 11px;
  color: #768390;
  letter-spacing: 0.14em;
  margin-bottom: 8px;
}
.lh-hero__stream-line { color: #c9d1d9; }
.lh-hero__stream-line--dim { color: #e3b341; }
.lh-hero__cursor {
  color: #e3b341;
  animation: lh-cursor 1.1s steps(2, start) infinite;
}
@keyframes lh-cursor { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .lh-hero__cursor { animation: none; }
}

.lh-hero__morph {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}
.lh-hero__morph-line { flex: 1; height: 1px; background: color-mix(in srgb, var(--_accent) 35%, transparent); }
.lh-hero__morph-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--_accent);
}
.lh-hero__card {
  background: var(--va-card, #ffffff);
  border-radius: 12px;
  padding: 16px;
}
.lh-hero__card-head {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--va-accent, #c2410c);
  margin-bottom: 12px;
}
@media (max-width: 1100px) {
  .lh-hero__inner { grid-template-columns: 1fr; gap: 44px; padding: 72px 20px 64px; }
  .lh-hero__title { font-size: 40px; }
}
</style>
