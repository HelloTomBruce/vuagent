<script setup lang="ts">
const badges = [
  { title: "契约单一事实来源", desc: "TypeBox Schema 单向推导三端类型，杜绝漂移" },
  { title: "强类型端到端", desc: "Props / 事件 / 18 种 SSE 事件全部有型可查" },
  { title: "零运行时依赖", desc: "peer 仅 vue ^3.5，图标随构建内联，装完即用" },
  { title: "亮暗双主题", desc: "--va-* 设计令牌一键换肤，跟随 data-theme" },
  { title: "动效尊重系统", desc: "全部动效遵循 prefers-reduced-motion" },
  { title: "AI 原生友好", desc: "llms.txt / llms-full.txt 随文档站分发" },
];
</script>

<template>
  <section class="lh-trust">
    <div class="lh-trust__inner">
      <div class="lh-trust__grid">
        <div v-for="b in badges" :key="b.title" class="lh-trust__item">
          <div class="lh-trust__item-title">{{ b.title }}</div>
          <p class="lh-trust__item-desc">{{ b.desc }}</p>
        </div>
      </div>
      <div class="lh-trust__footer">
        <div class="lh-trust__brand">
          <span class="lh-trust__brand-name">vuagent<span class="dot">.</span></span>
          <span class="lh-trust__license">MIT License · © 2026 HelloTomBruce</span>
        </div>
        <div class="lh-trust__links">
          <a href="https://github.com/HelloTomBruce/vuagent" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://hellotombruce.github.io/vuagent/" target="_blank" rel="noreferrer">文档站</a>
          <a href="https://www.npmjs.com/package/@vuagent/ui" target="_blank" rel="noreferrer">npm</a>
          <a href="https://hellotombruce.github.io/vuagent/llms-full.txt" target="_blank" rel="noreferrer">llms-full.txt</a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-trust {
  background: var(--va-ground-dark, #141311);
}
.lh-trust__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 64px 32px 40px;
}
.lh-trust__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.lh-trust__item {
  border: 1px solid rgba(240, 238, 233, 0.14);
  border-radius: 12px;
  padding: 16px 18px;
}
.lh-trust__item-title { font-size: 15px; font-weight: 700; color: var(--ink-inverse, #f0eee9); }
.lh-trust__item-desc { font-size: 12px; color: rgba(240, 238, 233, 0.55); line-height: 1.7; margin: 6px 0 0; }
.lh-trust__footer {
  margin-top: 48px;
  padding-top: 22px;
  border-top: 1px solid rgba(240, 238, 233, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.lh-trust__brand { display: flex; align-items: baseline; gap: 14px; }
.lh-trust__brand-name { font-size: 22px; font-weight: 800; color: var(--ink-inverse, #f0eee9); }
.lh-trust__brand-name .dot { color: var(--va-accent, #c2410c); }
.lh-trust__license { font-size: 11px; color: rgba(240, 238, 233, 0.4); }
.lh-trust__links { display: flex; gap: 20px; }
.lh-trust__links a {
  font-size: 13px;
  color: rgba(240, 238, 233, 0.7);
  text-decoration: none;
}
.lh-trust__links a:hover { color: #e8925e; }
@media (max-width: 960px) {
  .lh-trust__grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
