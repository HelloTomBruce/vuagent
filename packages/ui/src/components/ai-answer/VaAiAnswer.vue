<script setup lang="ts">
import type { AiAnswerEvents, AiAnswerProps } from "./types";
import type { AnswerSource } from "./types";
import { useCitedText } from "./useCitedText";

const props = defineProps<AiAnswerProps>();

const emit = defineEmits<AiAnswerEvents>();

function cite(index: number) {
  const src = props.sources[index];
  if (src) emit("source", src);
}

const { nodes } = useCitedText(
  () => props.answer,
  () => props.sources,
  cite,
);
</script>

<template>
  <article class="va-ans" :data-streaming="props.streaming ?? false">
    <p v-if="props.question" class="va-ans__q">{{ props.question }}</p>

    <div class="va-ans__body">
      <template v-for="(n, i) in nodes" :key="i">
        <component :is="n" />
      </template>
      <span v-if="props.streaming" class="va-ans__cursor" aria-hidden="true" />
      <span v-if="props.streaming" class="va-ans__sr">{{ props.streamingLabel ?? "正在生成回答" }}</span>
    </div>

    <footer v-if="props.sources.length" class="va-ans__sources">
      <h4 class="va-ans__src-title">来源</h4>
      <ol class="va-ans__list">
        <li v-for="(s, i) in props.sources" :key="s.id">
          <button class="va-ans__src" type="button" @click="emit('source', s as AnswerSource)">
            <span class="va-ans__no" aria-hidden="true">{{ i + 1 }}</span>
            <span class="va-ans__src-main">
              <span class="va-ans__src-title-text">{{ s.title }}</span>
              <span v-if="s.origin" class="va-ans__origin">{{ s.origin }}</span>
            </span>
          </button>
        </li>
      </ol>
    </footer>
  </article>
</template>

<style src="./VaAiAnswer.css"></style>
