<script setup lang="ts">
import type { OnboardingEvents, OnboardingProps } from "./types";

const props = defineProps<OnboardingProps>();

const emit = defineEmits<OnboardingEvents>();
</script>

<template>
  <section class="va-ob" aria-label="开始使用">
    <!-- 入场（TASK-107）：hero 上浮 + 步骤区延迟跟随，走 motion.css 统一协议
         （.va-enter-up，reduced-motion 由其媒体块降级为纯 fade） -->
    <div class="va-ob__hero va-enter-up">
      <span v-if="props.brand" class="va-ob__brand"><span class="va-ob__dot" aria-hidden="true" />{{ props.brand }}</span>
      <h1 class="va-ob__title">{{ props.title }}</h1>
      <p v-if="props.subtitle" class="va-ob__subtitle">{{ props.subtitle }}</p>
      <div class="va-ob__ctas">
        <button class="va-act va-act--lg va-act--primary va-ob__cta" type="button" @click="emit('cta')">
          {{ props.ctaLabel ?? "开始使用" }}
        </button>
        <button
          v-if="props.secondaryCtaLabel"
          class="va-act va-act--lg va-ob__cta"
          type="button"
          @click="emit('secondaryCta')"
        >{{ props.secondaryCtaLabel }}</button>
      </div>
      <slot name="hero-foot" />
    </div>

    <div v-if="$slots.default" class="va-ob__steps va-enter-up">
      <slot />
    </div>
  </section>
</template>

<style src="./VaOnboarding.css"></style>
