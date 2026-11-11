<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AppShellEvents, AppShellProps } from "./types";
import type { NavItem } from "./types";

const props = defineProps<AppShellProps>();

const emit = defineEmits<AppShellEvents>();

/* 当前导航（哨兵受控） */
const touched = ref(false);
const innerActive = ref(props.defaultActive ?? props.nav[0]?.id);
const activeId = computed(() =>
  props.active !== undefined || touched.value ? props.active : innerActive.value,
);
watch(
  () => props.nav,
  (nav) => {
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
  <div class="va-shell" :data-drawer="drawerOpen">
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

    <aside class="va-shell__side" :aria-label="`导航：${props.brand ?? '应用'}`">
      <span class="va-shell__brand"><span class="va-shell__dot" aria-hidden="true" />{{ props.brand ?? "Vuagent" }}</span>
      <nav class="va-shell__nav">
        <button
          v-for="item in props.nav"
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
      <div class="va-shell__side-foot"><slot name="sidebar-foot" /></div>
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
