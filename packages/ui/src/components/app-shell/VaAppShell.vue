<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import type { AppShellEvents, AppShellProps } from "./types";
import type { NavItem } from "./types";

const props = withDefaults(defineProps<AppShellProps>(), {
  nav: () => [],
  collapsible: false,
  collapsed: false,
  sidebarWidth: 264,
  flushContent: false,
  bounded: false,
});

const emit = defineEmits<AppShellEvents>();

/* 侧栏折叠（受控）：rail 64px，隐藏正文与页脚 */
const sideWidth = computed(() => (props.collapsed ? 64 : props.sidebarWidth));

function toggleCollapse() {
  emit("update:collapsed", !props.collapsed);
}

/* 当前导航（哨兵受控） */
const touched = ref(false);
const innerActive = ref(props.defaultActive ?? props.nav?.[0]?.id);
const activeId = computed(() =>
  props.active !== undefined || touched.value ? props.active : innerActive.value,
);
watch(
  () => props.nav,
  (nav = []) => {
    if (activeId.value && !nav.some((n) => n.id === activeId.value)) {
      touched.value = true;
      innerActive.value = nav[0]?.id;
      if (nav[0]) emit("update:active", nav[0].id);
    }
  },
);

/* 窄屏抽屉 */
const touchedDrawer = ref(false);
const innerDrawer = ref(false);
const drawerOpen = computed(() =>
  props.sidebarOpen !== undefined || touchedDrawer.value ? (props.sidebarOpen ?? false) : innerDrawer.value,
);
function toggleDrawer() {
  touchedDrawer.value = true;
  innerDrawer.value = !drawerOpen.value;
  emit("update:sidebarOpen", innerDrawer.value);
}

function pick(item: NavItem) {
  if (item.disabled) return;
  touched.value = true;
  innerActive.value = item.id;
  emit("update:active", item.id);
  emit("navigate", item);
  // 窄屏选完自动收抽屉
  if (drawerOpen.value) toggleDrawer();
}
</script>

<template>
  <div
    class="va-shell"
    :data-drawer="drawerOpen"
    :data-bounded="$props.bounded ?? false"
    :data-collapsed="$props.collapsed || undefined"
    :data-flush-content="$props.flushContent || undefined"
    :style="{ '--va-shell-side-width': `${sideWidth}px` }"
  >
    <button
      class="va-shell__burger"
      type="button"
      :aria-expanded="drawerOpen"
      aria-label="打开导航"
      @click="toggleDrawer"
    >≡</button>
    <div
      v-if="drawerOpen"
      class="va-shell__scrim"
      aria-hidden="true"
      @click="toggleDrawer"
    />

    <aside class="va-shell__side" :aria-label="`导航：${$props.brand ?? '应用'}`">
      <div class="va-shell__brand-row">
        <span class="va-shell__brand"><span class="va-shell__dot" aria-hidden="true" /><span class="va-shell__brand-text">{{ $props.brand ?? "Vuagent" }}</span></span>
        <button
          v-if="$props.collapsible"
          class="va-shell__collapse"
          type="button"
          :aria-label="$props.collapsed ? '展开侧栏' : '折叠侧栏'"
          :title="$props.collapsed ? '展开（⌘B）' : '折叠（⌘B）'"
          @click="toggleCollapse"
        >
          <ChevronLeft v-if="!$props.collapsed" :size="15" aria-hidden="true" />
          <ChevronRight v-else :size="15" aria-hidden="true" />
        </button>
      </div>
      <nav v-show="!$props.collapsed && (props.nav || []).length > 0" class="va-shell__nav">
        <button
          v-for="item in (props.nav || [])"
          :key="item.id"
          class="va-shell__item"
          type="button"
          :data-active="item.id === activeId"
          :disabled="item.disabled"
          @click="pick(item)"
        >
          <span class="va-shell__item-label">{{ item.label }}</span>
          <span v-if="item.badge" class="va-shell__badge">{{ item.badge > 99 ? "99+" : item.badge }}</span>
        </button>
      </nav>
      <div v-if="$slots['sidebar-body'] && !$props.collapsed" class="va-shell__side-body"><slot name="sidebar-body" /></div>
      <div v-if="!$props.collapsed" class="va-shell__side-foot"><slot name="sidebar-foot" /></div>
    </aside>

    <div class="va-shell__main">
      <header v-if="$slots.topbar" class="va-shell__topbar"><slot name="topbar" /></header>
      <main class="va-shell__content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style src="./VaAppShell.css"></style>
