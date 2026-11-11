<script setup lang="ts">
import type { PricingPlansEvents, PricingPlansProps } from "./types";
import type { PricingTier } from "./types";

const props = defineProps<PricingPlansProps>();

const emit = defineEmits<PricingPlansEvents>();
</script>

<template>
  <section class="va-price" aria-label="定价方案">
    <h3 v-if="props.title !== ''" class="va-price__title">{{ props.title ?? "选择适合的套餐" }}</h3>
    <div class="va-price__grid">
      <article
        v-for="t in props.tiers"
        :key="t.id"
        class="va-price__tier"
        :data-recommended="t.recommended ?? false"
        :data-current="t.current ?? false"
      >
        <header class="va-price__head">
          <span class="va-price__name">{{ t.name }}</span>
          <span v-if="t.recommended && !t.current" class="va-price__flag">推荐</span>
          <span v-if="t.current" class="va-price__flag va-price__flag--current">当前</span>
        </header>
        <p v-if="t.description" class="va-price__desc">{{ t.description }}</p>
        <p class="va-price__price">
          <strong>{{ t.price }}</strong>
          <span v-if="t.period" class="va-price__period">{{ t.period }}</span>
        </p>
        <ul class="va-price__features">
          <li v-for="f in t.features" :key="f">{{ f }}</li>
        </ul>
        <button
          class="va-act va-price__cta"
          :class="t.current || t.recommended ? 'va-act--primary' : ''"
          type="button"
          :disabled="t.current"
          @click="emit('choose', t as PricingTier)"
        >{{ t.current ? "使用中" : (t.ctaLabel ?? "选择") }}</button>
      </article>
    </div>
  </section>
</template>

<style src="./VaPricingPlans.css"></style>
