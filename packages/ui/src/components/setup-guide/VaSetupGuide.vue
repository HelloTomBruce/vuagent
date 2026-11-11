<script setup lang="ts">
import { computed, watch, ref } from "vue";
import type { SetupGuideEvents, SetupGuideProps } from "./types";

const props = defineProps<SetupGuideProps>();

const emit = defineEmits<SetupGuideEvents>();

const pending = computed(() => props.steps.filter((s) => !s.status));
const progress = computed(() => props.steps.length - pending.value.length);

const allDoneNotified = ref(false);
watch(
  () => props.steps.every((s) => s.status),
  (done, was) => {
    if (done && !was && !allDoneNotified.value) {
      allDoneNotified.value = true;
      emit("allDone");
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="va-sg" :aria-label="props.title ?? '开始准备'">
    <header class="va-sg__head">
      <h3 class="va-sg__title">{{ props.title ?? "开始准备" }}</h3>
      <span class="va-sg__progress" role="status">{{ progress }}/{{ steps.length }}</span>
    </header>

    <ol class="va-sg__list">
      <li
        v-for="s in steps"
        :key="s.id"
        class="va-sg__item"
        :data-status="s.status ?? 'pending'"
      >
        <span class="va-sg__mark" aria-hidden="true">
          <template v-if="s.status === 'done'">✓</template>
          <template v-else-if="s.status === 'skipped'">–</template>
        </span>
        <div class="va-sg__main">
          <span class="va-sg__name">{{ s.title }}</span>
          <span v-if="s.description" class="va-sg__desc">{{ s.description }}</span>
        </div>
        <div v-if="!s.status" class="va-sg__ops">
          <button class="va-act va-act--sm va-act--primary va-sg__btn" type="button" @click="emit('complete', s.id)">
            {{ s.actionLabel ?? "完成" }}
          </button>
          <button v-if="s.optional" class="va-act va-act--sm va-sg__btn" type="button" @click="emit('skip', s.id)">跳过</button>
        </div>
        <span v-else class="va-sg__state">{{ s.status === "done" ? "已完成" : "已跳过" }}</span>
      </li>
    </ol>

    <p v-if="!pending.length" class="va-sg__done">
      {{ props.finishLabel ?? "全部就绪，开始使用吧！" }}
    </p>
  </section>
</template>

<style src="./VaSetupGuide.css"></style>
