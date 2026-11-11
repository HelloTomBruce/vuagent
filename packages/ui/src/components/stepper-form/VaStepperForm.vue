<script setup lang="ts">
import { computed, ref } from "vue";
import type { StepperFormEvents, StepperFormProps } from "./types";
import { VaProgressTracker } from "../progress-tracker";

const props = defineProps<StepperFormProps>();

const emit = defineEmits<StepperFormEvents>();

/* 受控优先，touched 哨兵回落 defaultStep */
const touched = ref(false);
const innerStep = ref(props.defaultStep ?? 0);
const step = computed(() =>
  props.step !== undefined || touched.value ? props.step ?? 0 : innerStep.value,
);

const isLast = computed(() => step.value === props.steps.length - 1);

function setStep(v: number) {
  touched.value = true;
  innerStep.value = v;
  emit("update:step", v);
}

function goNext() {
  if (props.nextDisabled || props.submitting) return;
  const prev = step.value;
  if (isLast.value) {
    emit("submit", prev);
    return;
  }
  emit("next", prev);
  setStep(prev + 1);
}

function goBack() {
  if (step.value <= 0) return;
  const prev = step.value;
  emit("back", prev);
  setStep(prev - 1);
}
</script>

<template>
  <form class="va-sf" @submit.prevent="goNext">
    <VaProgressTracker
      class="va-sf__tracker"
      :steps="steps.map((s) => ({ label: s.title }))"
      :current="step"
      @select="(i) => i < step && setStep(i)"
    />

    <p v-if="steps[step]?.description" class="va-sf__desc">{{ steps[step]!.description }}</p>

    <!-- 每步内容：宿主用 <template #step-{id}> 提供对应内容 -->
    <div class="va-sf__body">
      <slot :name="`step-${steps[step]?.id}`" :step="step" />
    </div>

    <footer class="va-sf__foot">
      <button
        class="va-btn va-sf__btn"
        type="button"
        :disabled="step <= 0"
        @click="goBack"
      >{{ props.backLabel ?? "上一步" }}</button>
      <span class="va-sf__spacer" />
      <span class="va-sf__pos">{{ step + 1 }} / {{ steps.length }}</span>
      <button
        class="va-btn va-btn--primary va-sf__btn"
        type="submit"
        :disabled="props.nextDisabled || props.submitting"
      >
        {{ isLast ? (props.submitting ? "提交中…" : (props.finishLabel ?? "提交")) : (props.nextLabel ?? "下一步") }}
      </button>
    </footer>
  </form>
</template>

<style src="./VaStepperForm.css"></style>
