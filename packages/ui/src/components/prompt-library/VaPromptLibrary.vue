<script setup lang="ts">
import { computed, ref } from "vue";
import type { PromptLibraryEvents, PromptLibraryProps } from "./types";

const props = defineProps<PromptLibraryProps>();

const emit = defineEmits<PromptLibraryEvents>();

const innerQuery = ref("");
const query = computed(() => props.query ?? innerQuery.value);

function onInput(v: string) {
  innerQuery.value = v;
  emit("update:query", v);
}

const activeCat = ref<string>("__all");
const categories = computed(() => {
  const set = new Set<string>();
  for (const p of props.prompts) if (p.category) set.add(p.category);
  return [...set];
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.prompts.filter((p) => {
    if (activeCat.value !== "__all" && p.category !== activeCat.value) return false;
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.body.toLowerCase().includes(q) ||
      p.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });
});
</script>

<template>
  <div class="va-pl">
    <div class="va-pl__bar">
      <input
        class="va-pl__search"
        type="search"
        :value="query"
        :placeholder="props.placeholder ?? '搜索提示词…'"
        aria-label="搜索提示词"
        @input="onInput(($event.target as HTMLInputElement).value)"
      >
      <div v-if="categories.length" class="va-pl__cats" role="tablist" aria-label="分类">
        <button
          class="va-pl__cat"
          type="button"
          role="tab"
          :aria-selected="activeCat === '__all'"
          :data-active="activeCat === '__all'"
          @click="activeCat = '__all'"
        >全部</button>
        <button
          v-for="c in categories"
          :key="c"
          class="va-pl__cat"
          type="button"
          role="tab"
          :aria-selected="activeCat === c"
          :data-active="activeCat === c"
          @click="activeCat = c"
        >{{ c }}</button>
      </div>
    </div>

    <p v-if="!filtered.length" class="va-pl__empty">{{ props.emptyLabel ?? "没有匹配的提示词" }}</p>
    <ul v-else class="va-pl__list">
      <li v-for="p in filtered" :key="p.id" class="va-pl__card">
        <header class="va-pl__head">
          <span class="va-pl__title">{{ p.title }}</span>
          <span v-if="p.category" class="va-pl__badge">{{ p.category }}</span>
        </header>
        <p
          class="va-pl__body"
          :style="{ maxHeight: `${props.bodyClamp ?? 88}px` }"
        >{{ p.body }}</p>
        <footer class="va-pl__foot">
          <span v-if="p.tags?.length" class="va-pl__tags">
            <span v-for="t in p.tags" :key="t" class="va-pl__tag">#{{ t }}</span>
          </span>
          <button class="va-btn va-btn--sm va-btn--primary va-pl__use" type="button" @click="emit('use', p)">使用</button>
        </footer>
      </li>
    </ul>
  </div>
</template>

<style src="./VaPromptLibrary.css"></style>
