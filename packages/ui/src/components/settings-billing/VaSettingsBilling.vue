<script setup lang="ts">
import { computed, ref } from "vue";
import type { SettingsBillingEvents, SettingsBillingProps } from "./types";
import type { BillingPlan } from "./types";

const props = defineProps<SettingsBillingProps>();

const emit = defineEmits<SettingsBillingEvents>();

/* 设置导航（哨兵受控） */
const touched = ref(false);
const innerActive = ref(props.defaultActive ?? props.nav?.[0]?.id);
const activeId = computed(() =>
  props.active !== undefined || touched.value ? props.active : innerActive.value,
);

function pickNav(id: string) {
  touched.value = true;
  innerActive.value = id;
  emit("update:active", id);
}
</script>

<template>
  <div class="va-bill">
    <aside v-if="props.nav?.length" class="va-bill__nav" :aria-label="`设置导航`">
      <h3 v-if="props.title" class="va-bill__title">{{ props.title }}</h3>
      <button
        v-for="n in props.nav"
        :key="n.id"
        class="va-bill__item"
        type="button"
        :data-active="n.id === activeId"
        @click="pickNav(n.id)"
      >
        {{ n.label }}
        <span v-if="n.badge" class="va-bill__badge">{{ n.badge }}</span>
      </button>
    </aside>

    <main class="va-bill__main">
      <slot name="usage" />

      <section class="va-bill__plans" aria-label="订阅套餐">
        <h3 class="va-bill__section-title">套餐</h3>
        <slot name="plans">
          <div v-if="props.plans?.length" class="va-bill__grid">
            <article
              v-for="p in props.plans"
              :key="p.id"
              class="va-bill__plan"
              :data-current="p.current ?? false"
              :data-recommended="p.recommended ?? false"
            >
              <header class="va-bill__plan-head">
                <span class="va-bill__plan-name">{{ p.name }}</span>
                <span v-if="p.recommended && !p.current" class="va-bill__flag">推荐</span>
                <span v-if="p.current" class="va-bill__flag va-bill__flag--current">当前</span>
              </header>
              <strong class="va-bill__price">{{ p.price }}</strong>
              <ul class="va-bill__features">
                <li v-for="f in p.features" :key="f">{{ f }}</li>
              </ul>
              <button
                class="va-act va-bill__choose"
                :class="p.current ? '' : 'va-act--primary'"
                type="button"
                :disabled="p.current"
                @click="emit('choosePlan', p as BillingPlan)"
              >{{ p.current ? "使用中" : "切换到此套餐" }}</button>
            </article>
          </div>
        </slot>
      </section>

      <slot />
    </main>
  </div>
</template>

<style src="./VaSettingsBilling.css"></style>
