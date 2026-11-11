<script setup lang="ts">
import { computed } from "vue";
import type { ModelWheelProps } from "./types";

const props = defineProps<ModelWheelProps>();

const size = computed(() => props.size ?? 200);

const seatOf = (i: number, total: number) => (total <= 1 ? 0 : (360 / total) * i - 90);
const initials = (name: string) => name.slice(0, 1).toUpperCase();
</script>

<template>
  <div
    class="va-wheel"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="img"
    :aria-label="`模型轮盘：${props.models.map((m) => m.name).join('、')}`"
  >
    <div class="va-wheel__ring" :class="{ 'va-wheel__ring--spin': props.spinning !== false }">
      <span
        v-for="(m, i) in props.models"
        :key="m.id"
        class="va-wheel__seat"
        :style="{ transform: `rotate(${seatOf(i, props.models.length)}deg) translate(${size / 2 - 26}px) rotate(${-seatOf(i, props.models.length)}deg)` }"
      >
        <span class="va-wheel__chip" :title="m.name">{{ initials(m.name) }}</span>
      </span>
    </div>
    <span v-if="props.centerLabel" class="va-wheel__center">{{ props.centerLabel }}</span>
  </div>
</template>

<style src="./VaModelWheel.css"></style>
