<script setup lang="ts">
import { useRoute } from "vue-router";
import { router } from "./router";
import { useTheme, type ThemePreference } from "./console/composables/useTheme";

/** 三态主题选项（亮色 / 暗色 / 跟随系统），顺序即 UI 呈现顺序 */
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: string }> = [
  { value: "light", label: "亮色", icon: "☀" },
  { value: "dark", label: "暗色", icon: "🌙" },
  { value: "system", label: "系统", icon: "🖥" },
];

const { preference, resolved, setPreference } = useTheme();

/** 系统态的 title 提示当前解析结果 */
function themeTitle(value: ThemePreference): string {
  if (value !== "system") return value === "light" ? "亮色主题" : "暗色主题";
  return `跟随系统（当前 ${resolved.value === "dark" ? "暗色" : "亮色"}）`;
}

const route = useRoute();
router.afterEach((to) => {
  if (to.meta.title && typeof document !== "undefined") {
    document.title = `Vuagent · ${String(to.meta.title)}`;
  }
});
</script>

<template>
  <div class="pg">
    <header class="pg__bar">
      <span class="pg__brand"
        ><svg class="pg__mark" viewBox="0 0 32 32" fill="none" stroke-linecap="round" aria-hidden="true">
          <path d="M9 7 L14.4 25.4" stroke="currentColor" stroke-width="2.4" />
          <path d="M17.6 22.6 L23 7" stroke="var(--va-accent, #c2410c)" stroke-width="2.4" />
          <circle cx="16" cy="24" r="3.1" stroke="var(--va-accent, #c2410c)" stroke-width="2.1" />
          <circle cx="23" cy="7" r="1.9" fill="var(--va-accent, #c2410c)" stroke="none" />
        </svg>
        Vuagent <small>playground</small></span
      >
      <nav class="pg__nav" aria-label="demo 页面">
        <RouterLink
          v-for="r in router.getRoutes().filter((x) => x.name)"
          :key="String(r.name)"
          :to="{ name: r.name }"
          class="pg__link"
          active-class="pg__link--on"
        >
          {{ r.meta.title }}
        </RouterLink>
      </nav>
      <div class="pg__theme" role="group" aria-label="主题切换">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.value"
          type="button"
          class="pg__theme-opt"
          :class="{ 'pg__theme-opt--on': preference === opt.value }"
          :aria-pressed="preference === opt.value"
          :title="themeTitle(opt.value)"
          @click="setPreference(opt.value)"
        >
          <span class="pg__theme-icon" aria-hidden="true">{{ opt.icon }}</span>{{ opt.label }}
        </button>
      </div>
    </header>

    <main :key="String(route.path)" class="pg__main" :class="{ 'pg__main--fullscreen': route.name === 'console' }">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.pg {
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px 24px 72px;
}

.pg:has(.pg__main--fullscreen) {
  max-width: 100vw;
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pg:has(.pg__main--fullscreen) .pg__bar {
  margin: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
}

.pg__main--fullscreen {
  flex: 1;
  overflow: hidden;
  height: calc(100vh - 49px);
}

.pg__bar {
  position: sticky;
  top: 0;
  z-index: var(--va-z-sticky, 50);
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 0 -24px 22px;
  padding: 10px 24px;
  background: color-mix(in srgb, var(--va-bg, #f7f6f2) 85%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
}

.pg__brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-weight: 700;
  white-space: nowrap;
}

.pg__brand small { font-weight: 500; color: var(--va-muted, #6f6d66); font-size: 11.5px; }

/* 主题三态切换（亮/暗/跟随系统）：总高 30px 与 VaButton sm 等高，头栏高度不变 */
.pg__theme {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-s, 8px);
  background: var(--va-bg-subtle, #efede7);
}

.pg__theme-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: calc(var(--va-radius-s, 8px) - 2px);
  background: transparent;
  color: var(--va-ink-2, #43413c);
  font-family: inherit;
  font-size: var(--va-fs-xs, 11px);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--va-dur-1, 120ms) var(--va-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--va-dur-1, 120ms) var(--va-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.pg__theme-opt:hover { color: var(--va-ink, #1a1917); }

.pg__theme-opt:focus-visible {
  outline: 2px solid var(--va-accent-soft, rgba(194, 65, 12, 0.1));
  outline-offset: 1px;
}

.pg__theme-opt--on {
  background: var(--va-card, #ffffff);
  color: var(--va-ink, #1a1917);
  font-weight: var(--va-fw-semibold, 600);
  box-shadow: var(--va-shadow-1, 0 1px 2px rgba(26, 25, 23, 0.06));
}

.pg__theme-icon { font-size: var(--va-fs-xs, 11px); line-height: 1; }

.pg__mark {
  width: 18px;
  height: 18px;
  color: var(--va-ink, #1a1917); /* 计划笔画随亮暗主题换色,橙色部件绑定 --va-accent */
}

.pg__nav {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
}

.pg__nav::-webkit-scrollbar { display: none; }

.pg__link {
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--va-ink-2, #43413c);
  font-size: 13px;
  padding: 5px 12px;
  text-decoration: none;
  white-space: nowrap;
}

.pg__link:hover { background: var(--va-bg-subtle, #efede7); color: var(--va-ink, #1a1917); }

.pg__link--on {
  background: var(--va-card, #fff);
  border-color: var(--va-edge, rgba(26, 25, 23, 0.12));
  color: var(--va-ink, #1a1917);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(26, 25, 23, 0.06);
}

.pg__main { animation: pg-in var(--va-dur-2, 200ms) cubic-bezier(0.22, 1, 0.36, 1); }

@keyframes pg-in {
  from { opacity: 0; transform: translateY(4px); }
}

@media (prefers-reduced-motion: reduce) {
  .pg__main { animation: none; }
}
</style>
