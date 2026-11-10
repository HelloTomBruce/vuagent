<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import type { ProfileMenuEvents, ProfileMenuProps } from "./types";

const props = defineProps<ProfileMenuProps>();

const emit = defineEmits<ProfileMenuEvents>();

const open = ref(false);
const rootEl = useTemplateRef<HTMLElement>("root");

function toggle() {
  open.value = !open.value;
}

/** Esc 关闭 + 点击外部关闭（SSR 安全：onMounted 内挂） */
function onDocMousedown(e: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false;
}
function onDocKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    open.value = false;
    rootEl.value?.querySelector<HTMLElement>(".va-pm__trigger")?.focus();
  }
}
onMounted(() => {
  if (typeof document === "undefined") return;
  document.addEventListener("mousedown", onDocMousedown);
  document.addEventListener("keydown", onDocKeydown);
});
onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.removeEventListener("mousedown", onDocMousedown);
  document.removeEventListener("keydown", onDocKeydown);
});

const AVATAR_HUES = [16, 145, 210, 268];
const hue = (props.name.length % AVATAR_HUES.length);
</script>

<template>
  <div ref="root" class="va-pm">
    <button
      class="va-pm__trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <img v-if="props.avatar" class="va-pm__avatar" :src="props.avatar" :alt="props.name">
      <span
        v-else
        class="va-pm__avatar va-pm__avatar--text"
        :style="{ background: `hsl(${AVATAR_HUES[hue]} 45% 88%)`, color: `hsl(${AVATAR_HUES[hue]} 45% 30%)` }"
        aria-hidden="true"
      >{{ props.initials ?? props.name.slice(0, 1).toUpperCase() }}</span>
      <span v-if="props.badge" class="va-pm__badge">{{ props.badge > 99 ? "99+" : props.badge }}</span>
    </button>

    <div
      v-if="open"
      class="va-pm__menu"
      role="menu"
      :aria-label="`账户菜单：${props.name}`"
    >
      <header class="va-pm__head">
        <span class="va-pm__name">{{ props.name }}</span>
        <span v-if="props.email" class="va-pm__email">{{ props.email }}</span>
      </header>
      <button
        v-for="item in props.items ?? []"
        :key="item.id"
        class="va-pm__item"
        type="button"
        role="menuitem"
        :data-danger="item.danger"
        :disabled="item.disabled"
        @click="emit('select', item)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style src="./VaProfileMenu.css"></style>
