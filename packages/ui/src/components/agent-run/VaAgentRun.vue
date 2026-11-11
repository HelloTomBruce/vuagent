<script setup lang="ts">
import type { AgentRunProps } from "./types";
import { formatMs } from "../../utils/format";

const props = defineProps<AgentRunProps>();

const STATUS_TEXT = { running: "运行中", success: "已完成", error: "失败" } as const;
</script>

<template>
  <section class="va-run" :class="{ 'va-run--compact': props.compact }">
    <header class="va-run__head">
      <span class="va-run__title">{{ props.title ?? "Agent 运行" }}</span>
      <span
        v-if="props.status"
        class="va-run__status"
        :data-status="props.status"
        role="status"
      >{{ props.statusLabel ?? STATUS_TEXT[props.status] }}</span>
      <span class="va-run__spacer" />
      <span v-if="props.duration !== undefined" class="va-run__time">{{ formatMs(props.duration) }}</span>
      <div v-if="$slots.actions" class="va-run__actions"><slot name="actions" /></div>
    </header>

    <div class="va-run__grid">
      <section class="va-run__col va-run__col--plan" :aria-label="`计划`">
        <h3 class="va-run__col-title">计划</h3>
        <slot name="plan" />
      </section>
      <section class="va-run__col va-run__col--stream" aria-label="执行流">
        <h3 class="va-run__col-title">执行流</h3>
        <slot />
      </section>
      <section class="va-run__col va-run__col--aside" aria-label="上下文">
        <h3 class="va-run__col-title">上下文</h3>
        <slot name="aside" />
      </section>
    </div>
  </section>
</template>

<style src="./VaAgentRun.css"></style>
