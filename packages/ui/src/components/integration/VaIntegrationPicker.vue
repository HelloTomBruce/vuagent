<script setup lang="ts">
import type { IntegrationPickerEvents, IntegrationPickerProps } from "./types";

const props = defineProps<IntegrationPickerProps>();

const emit = defineEmits<IntegrationPickerEvents>();

function onClick(item: (typeof props.items)[number]) {
  emit("select", item);
  emit("toggle", item);
}

const AVATAR_HUES = [16, 145, 210, 268, 34, 190];
const hueOf = (id: string) => AVATAR_HUES[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_HUES.length]!;
</script>

<template>
  <ul
    class="va-ipk"
    :class="{ 'va-ipk--stacked': props.stacked }"
    :style="!props.stacked && props.minCardWidth ? { gridTemplateColumns: `repeat(auto-fill, minmax(${props.minCardWidth}px, 1fr))` } : undefined"
    role="list"
    aria-label="集成服务"
  >
    <li v-for="item in props.items" :key="item.id">
      <button
        class="va-ipk__card"
        type="button"
        :data-connected="item.connected ?? false"
        :aria-pressed="item.connected ?? false"
        @click="onClick(item)"
      >
        <img v-if="item.icon" class="va-ipk__icon" :src="item.icon" :alt="''">
        <span
          v-else
          class="va-ipk__icon va-ipk__icon--text"
          :style="{ background: `hsl(${hueOf(item.id)} 45% 88%)`, color: `hsl(${hueOf(item.id)} 45% 30%)` }"
          aria-hidden="true"
        >{{ item.name.slice(0, 1) }}</span>
        <span class="va-ipk__main">
          <span class="va-ipk__name">{{ item.name }}</span>
          <span v-if="item.description" class="va-ipk__desc">{{ item.description }}</span>
        </span>
        <span class="va-ipk__state" :data-connected="item.connected ?? false">
          {{ item.connected ? "已连接" : "连接" }}
        </span>
      </button>
    </li>
  </ul>
</template>

<style src="./VaIntegrationPicker.css"></style>
