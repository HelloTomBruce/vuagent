<script setup lang="ts">
import { computed } from "vue";
import type { VoiceOrbProps } from "./types";

const props = defineProps<VoiceOrbProps>();

const size = computed(() => props.size ?? 96);
const color = computed(() => props.color ?? "var(--va-accent)");

const STATE_LABEL = { idle: "待命", listening: "聆听中", speaking: "说话中" } as const;
</script>

<template>
  <div
    class="va-orb"
    :class="`va-orb--${props.state ?? 'idle'}`"
    :style="{ width: `${size}px`, height: `${size}px`, '--va-orb-c': color }"
    role="img"
    :aria-label="`语音助手：${STATE_LABEL[props.state ?? 'idle']}`"
  >
    <span class="va-orb__wave va-orb__wave--1" aria-hidden="true" />
    <span class="va-orb__wave va-orb__wave--2" aria-hidden="true" />
    <span class="va-orb__core" aria-hidden="true">
      <span class="va-orb__bar" /><span class="va-orb__bar" /><span class="va-orb__bar" /><span class="va-orb__bar" />
    </span>
  </div>
</template>

<style src="./VaVoiceOrb.css"></style>
