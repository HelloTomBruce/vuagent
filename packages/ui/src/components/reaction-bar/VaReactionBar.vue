<script setup lang="ts">
import type { ReactionBarEvents, ReactionBarProps } from "./types";

const props = defineProps<ReactionBarProps>();

const emit = defineEmits<ReactionBarEvents>();

function toggle(i: number) {
  const item = props.reactions[i]!;
  if (item.disabled) return;
  const next = !item.active;
  emit("toggle", item, next);
}
</script>

<template>
  <div class="va-rx" role="group" aria-label="快速反馈">
    <button
      v-for="(r, i) in props.reactions"
      :key="r.id"
      class="va-rx__btn"
      type="button"
      :aria-pressed="r.active ?? false"
      :data-active="r.active ?? false"
      :disabled="r.disabled"
      :title="r.label"
      @click="toggle(i)"
    >
      <span class="va-rx__emoji" aria-hidden="true">{{ r.emoji }}</span>
      <span v-if="r.label" class="va-rx__label">{{ r.label }}</span>
      <span v-if="r.count !== undefined" class="va-rx__count" :aria-label="`${r.count} 人`">{{ r.count }}</span>
    </button>
  </div>
</template>

<style src="./VaReactionBar.css"></style>
