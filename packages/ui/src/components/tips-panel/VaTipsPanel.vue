<script setup lang="ts">
import type { TipsPanelEvents, TipsPanelProps } from "./types";

const props = defineProps<TipsPanelProps>();

const emit = defineEmits<TipsPanelEvents>();
</script>

<template>
  <aside v-if="tips.length" class="va-tips" aria-label="使用技巧">
    <header class="va-tips__head">
      <span class="va-tips__icon" aria-hidden="true">💡</span>
      <span class="va-tips__title">{{ props.title ?? "使用技巧" }}</span>
    </header>
    <ul class="va-tips__list">
      <li v-for="t in tips" :key="t.id" class="va-tips__item">
        <div class="va-tips__main">
          <span class="va-tips__t">{{ t.title }}</span>
          <span class="va-tips__b">{{ t.body }}</span>
        </div>
        <button
          v-if="props.dismissible"
          class="va-tips__close"
          type="button"
          :aria-label="`关闭技巧：${t.title}`"
          @click="emit('dismiss', t.id)"
        >×</button>
      </li>
    </ul>
  </aside>
  <p v-else-if="props.emptyLabel" class="va-tips__empty">{{ props.emptyLabel }}</p>
</template>

<style src="./VaTipsPanel.css"></style>
