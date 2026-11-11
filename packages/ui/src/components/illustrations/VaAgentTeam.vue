<script setup lang="ts">
import { computed } from "vue";
import type { AgentTeamProps } from "./types";

const props = defineProps<AgentTeamProps>();

const size = computed(() => props.size ?? 180);

/** 环形排布角度（deg） */
const seatOf = (i: number, total: number) => (total <= 1 ? 0 : (360 / total) * i - 90);
const initials = (name: string) => name.slice(0, 1).toUpperCase();
</script>

<template>
  <div
    class="va-team"
    :class="{ 'va-team--float': props.floating !== false }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="img"
    :aria-label="`agent 团队：${props.agents.map((a) => a.name).join('、')}`"
  >
    <span class="va-team__hub" aria-hidden="true">✦</span>
    <span
      v-for="(a, i) in props.agents"
      :key="a.id"
      class="va-team__seat"
      :style="{ transform: `rotate(${seatOf(i, props.agents.length)}deg) translate(${size / 2 - 22}px) rotate(${-seatOf(i, props.agents.length)}deg)`, animationDelay: `${i * 0.4}s` }"
    >
      <span class="va-team__chip">{{ initials(a.name) }}</span>
    </span>
  </div>
</template>

<style src="./VaAgentTeam.css"></style>
