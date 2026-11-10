<script setup lang="ts">
import type { SmartRecommendationEvents, SmartRecommendationProps } from "./types";

const props = withDefaults(defineProps<SmartRecommendationProps>(), { dismissible: true });

const emit = defineEmits<SmartRecommendationEvents>();
</script>

<template>
  <aside class="va-rec" role="note" aria-label="agent 建议">
    <span class="va-rec__spark" aria-hidden="true">✦</span>
    <div class="va-rec__main">
      <header class="va-rec__head">
        <span class="va-rec__title">{{ props.title }}</span>
        <span v-if="props.impact" class="va-rec__impact">{{ props.impact }}</span>
      </header>
      <p v-if="props.description" class="va-rec__desc">{{ props.description }}</p>
      <footer class="va-rec__ops">
        <button
          v-for="a in props.actions"
          :key="a.id"
          class="va-rec__btn"
          type="button"
          :data-primary="a.primary ?? false"
          @click="emit('action', a.id)"
        >{{ a.label }}</button>
      </footer>
    </div>
    <button
      v-if="props.dismissible"
      class="va-rec__close"
      type="button"
      :aria-label="props.dismissLabel ?? '忽略此建议'"
      @click="emit('dismiss')"
    >×</button>
  </aside>
</template>

<style src="./VaSmartRecommendation.css"></style>
