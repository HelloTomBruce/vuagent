<script setup lang="ts">
import { computed } from "vue";
import { withBase } from "vitepress";
import { components } from "../../../../../../meta/components.mjs";

const byCategory = computed(() => {
  const map = new Map<string, { slug: string; title: string; desc: string }[]>();
  for (const c of components) {
    const list = map.get(c.category) ?? [];
    list.push({ slug: c.slug, title: c.title, desc: c.desc });
    map.set(c.category, list);
  }
  return [...map.entries()];
});

const total = components.length;

/** meta 分类 → 文档站分类页（按分类组织，非每组件一页）；未建页的分类回退组件总览 */
const CATEGORY_PAGE: Record<string, string> = {
  "Agent-Ops": "/components/agent-ops",
  Chat: "/components/chat",
  "图表": "/components/charts",
  "表单": "/components/forms",
  "动效": "/components/effects",
  Screens: "/components/screens",
  Overlay: "/components/overlays",
};

function categoryLink(cat: string): string {
  return withBase(CATEGORY_PAGE[cat] ?? "/components/");
}
</script>

<template>
  <section class="lh-matrix">
    <div class="lh-matrix__inner">
      <h2 class="lh-sec-title">{{ total }} 个运行时组件，按能力分类</h2>
      <p class="lh-sec-sub">
        与 npm 包、shadcn-vue registry 同源生成（meta 单一数据源），落地页不会出现过期组件清单。
        全部组件强类型、独立样式、零运行时依赖，支持单文件拷贝。
      </p>
      <div v-for="[cat, list] in byCategory" :key="cat" class="lh-matrix__cat">
        <div class="lh-matrix__cat-head">
          <span class="lh-matrix__cat-name">{{ cat }}</span>
          <span class="lh-matrix__cat-count">{{ list.length }}</span>
        </div>
        <div class="lh-matrix__chips">
          <a
            v-for="c in list"
            :key="c.slug"
            class="lh-matrix__chip"
            :title="c.desc"
            :href="categoryLink(cat)"
          >{{ c.title }}</a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-matrix { background: var(--va-card, #ffffff); border-top: 1px solid var(--va-edge, rgba(26, 25, 23, 0.1)); }
.lh-matrix__inner { max-width: 1180px; margin: 0 auto; padding: 72px 32px; }
.lh-sec-title { margin: 0; font-size: 34px; font-weight: 800; color: var(--va-ink, #1a1917); }
.lh-sec-sub { margin: 12px 0 0; font-size: 15px; color: var(--va-muted, #6f6d66); max-width: 780px; line-height: 1.8; }
.lh-matrix__cat { margin-top: 30px; }
.lh-matrix__cat-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.lh-matrix__cat-name { font-size: 15px; font-weight: 700; color: var(--va-ink, #1a1917); }
.lh-matrix__cat-count {
  font-size: 11px; font-weight: 600; color: var(--va-muted, #6f6d66);
  background: var(--va-bg-subtle, #efede7); border-radius: 999px; padding: 2px 9px;
}
.lh-matrix__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.lh-matrix__chip {
  font-size: 12px;
  font-weight: 500;
  color: var(--va-ink-2, #43413c);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: 8px;
  padding: 5px 12px;
  text-decoration: none;
  transition: all 0.12s;
}
.lh-matrix__chip:hover {
  border-color: var(--va-accent, #c2410c);
  color: var(--va-accent, #c2410c);
  background: rgba(194, 65, 12, 0.06);
}
</style>
