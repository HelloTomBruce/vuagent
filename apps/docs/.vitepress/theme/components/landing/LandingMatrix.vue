<script setup lang="ts">
import { computed } from "vue";
import { withBase } from "vitepress";
import { components } from "../../../../../../meta/components.mjs";

/** meta 分类 → 统一中文命名 */
const CATEGORY_CN: Record<string, string> = {
  "Agent-Ops": "运维操作",
  Chat: "对话",
  "基础": "基础",
  "动效": "动效",
  "表单": "表单",
  "反馈": "反馈",
  "图表": "图表",
  Screens: "页面骨架",
  Blocks: "组合块",
  Illustrations: "插画",
};

/** meta 分类 → 文档站分类页；未建页分类回退组件总览 */
const CATEGORY_PAGE: Record<string, string> = {
  "Agent-Ops": "/components/agent-ops",
  Chat: "/components/chat",
  "图表": "/components/charts",
  "表单": "/components/forms",
  "动效": "/components/effects",
  Screens: "/components/screens",
  Overlay: "/components/overlays",
};

const REPRESENTATIVE_COUNT = 5;

const byCategory = computed(() => {
  const map = new Map<string, { slug: string; title: string; desc: string }[]>();
  for (const c of components) {
    const list = map.get(c.category) ?? [];
    list.push({ slug: c.slug, title: c.title, desc: c.desc });
    map.set(c.category, list);
  }
  return [...map.entries()].map(([cat, list]) => ({
    cat,
    cn: CATEGORY_CN[cat] ?? cat,
    total: list.length,
    reps: list.slice(0, REPRESENTATIVE_COUNT),
    link: withBase(CATEGORY_PAGE[cat] ?? "/components/"),
  }));
});

const total = components.length;
</script>

<template>
  <section class="lh-matrix">
    <div class="lh-matrix__inner">
      <h2 class="lh-sec-title">{{ total }} 个运行时组件，按能力分类</h2>
      <p class="lh-sec-sub">
        与 npm 包、shadcn-vue registry 同源生成（meta 单一数据源），落地页不会出现过期组件清单。
        每类列出代表组件，全部明细进文档站对应分类页。
      </p>
      <div class="lh-matrix__grid">
        <div v-for="cat in byCategory" :key="cat.cat" class="lh-matrix__card">
          <div class="lh-matrix__card-head">
            <span class="lh-matrix__cat-name">{{ cat.cn }}</span>
            <span class="lh-matrix__cat-count">{{ cat.total }}</span>
          </div>
          <div class="lh-matrix__chips">
            <span v-for="c in cat.reps" :key="c.slug" class="lh-matrix__chip" :title="c.desc">{{ c.title }}</span>
          </div>
          <a class="lh-matrix__more" :href="cat.link">查看全部 {{ cat.total }} 个 →</a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 全页唯一「追光池」：暗色舞台上的亮色段落 */
.lh-matrix {
  background: var(--va-bg, #f7f6f2);
  border-top: 1px solid var(--va-edge, rgba(26, 25, 23, 0.1));
}
.lh-matrix__inner { max-width: 1180px; margin: 0 auto; padding: 72px 32px; }
.lh-sec-title { margin: 0; font-size: 34px; font-weight: 800; color: var(--va-ink, #1a1917); }
.lh-sec-sub { margin: 12px 0 0; font-size: 15px; color: var(--va-muted, #6f6d66); max-width: 780px; line-height: 1.8; }
.lh-matrix__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  margin-top: 36px;
}
.lh-matrix__card {
  background: var(--va-card, #ffffff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.1));
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lh-matrix__card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lh-matrix__cat-name { font-size: 15px; font-weight: 700; color: var(--va-ink, #1a1917); }
.lh-matrix__cat-count {
  font-size: 11px; font-weight: 600; color: var(--va-muted, #6f6d66);
  background: var(--va-bg-subtle, #efede7); border-radius: 999px; padding: 2px 9px;
}
.lh-matrix__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.lh-matrix__chip {
  font-size: 12px;
  color: var(--va-ink-2, #43413c);
  background: var(--va-bg-subtle, #efede7);
  border-radius: 6px;
  padding: 4px 10px;
}
.lh-matrix__more {
  font-size: 12px;
  font-weight: 600;
  color: var(--va-accent, #c2410c);
  text-decoration: none;
  margin-top: auto;
}
.lh-matrix__more:hover { text-decoration: underline; }
</style>
