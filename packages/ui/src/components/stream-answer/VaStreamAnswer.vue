<script setup lang="ts">
import type { StreamAnswerProps } from "./types";
import { useStreamAnswer } from "./useStreamAnswer";

const props = withDefaults(defineProps<StreamAnswerProps>(), {
  autoPlay: true,
  interval: 24,
  chunk: 2,
});

const emit = defineEmits<{ complete: [] }>();

const { text, playing, replay } = useStreamAnswer(props, {
  complete: () => emit("complete"),
});

defineExpose({ replay });
</script>

<template>
  <div class="va-stream" :data-streaming="playing || undefined">
    <span class="va-stream__text">{{ text }}</span><span v-if="playing" class="va-stream__caret" aria-hidden="true" />
  </div>
</template>

<style src="./VaStreamAnswer.css"></style>
