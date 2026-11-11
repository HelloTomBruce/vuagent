<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { VaButton } from "@vuagent/ui";
import { router } from "./router";

const theme = ref<"light" | "dark">("light");

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme.value;
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
      <span class="pg__brand"><span class="pg__dot" />Vuagent <small>playground</small></span>
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
      <VaButton variant="secondary" size="sm" @click="toggleTheme">
        {{ theme === "light" ? "🌙 暗色" : "☀️ 亮色" }}
      </VaButton>
    </header>

    <main :key="String(route.path)" class="pg__main">
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

.pg__bar {
  position: sticky;
  top: 0;
  z-index: 50;
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

.pg__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--va-accent, #c2410c);
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

.pg__main { animation: pg-in 200ms cubic-bezier(0.22, 1, 0.36, 1); }

@keyframes pg-in {
  from { opacity: 0; transform: translateY(4px); }
}

@media (prefers-reduced-motion: reduce) {
  .pg__main { animation: none; }
}
</style>
