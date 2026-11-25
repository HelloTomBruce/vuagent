<script setup lang="ts">
import { computed } from "vue";
import type { CapabilityCardProps } from "./types";

const props = withDefaults(defineProps<CapabilityCardProps>(), {
  title: undefined,
  description: undefined,
  events: undefined,
  components: undefined,
  hint: undefined,
  dismissible: false,
});

const emit = defineEmits<{ dismiss: [] }>();

const heading = computed(() => props.title ?? `${props.name} 已启用`);
const hasLists = computed(() => (props.events?.length ?? 0) > 0 || (props.components?.length ?? 0) > 0);
</script>

<template>
  <!-- 入场（TASK-108）：.va-enter-up（motion.css 统一协议，reduced-motion 由其媒体块降级） -->
  <section class="va-cap va-enter-up" aria-label="能力级别说明">
    <div class="va-cap__head">
      <span class="va-cap__badge" aria-hidden="true">L{{ props.level }}</span>
      <strong class="va-cap__title">{{ heading }}</strong>
      <button v-if="props.dismissible" class="va-cap__close" type="button" aria-label="关闭说明" @click="emit('dismiss')">×</button>
    </div>
    <p v-if="props.description" class="va-cap__desc">{{ props.description }}</p>
    <div v-if="hasLists" class="va-cap__grid">
      <div v-if="props.events?.length" class="va-cap__col">
        <span class="va-cap__label">协议事件</span>
        <code v-for="e in props.events" :key="e" class="va-cap__tag">{{ e }}</code>
      </div>
      <div v-if="props.components?.length" class="va-cap__col">
        <span class="va-cap__label">涉及组件</span>
        <span v-for="c in props.components" :key="c" class="va-cap__comp">{{ c }}</span>
      </div>
    </div>
    <p v-if="props.hint" class="va-cap__hint">{{ props.hint }}</p>
  </section>
</template>

<style src="./VaCapabilityCard.css"></style>
