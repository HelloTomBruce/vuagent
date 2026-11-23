<script setup lang="ts">
import { computed } from "vue";
import MarkdownIt from "markdown-it";
import type { MarkdownProps } from "./types";

const props = withDefaults(defineProps<MarkdownProps>(), {
  content: "",
  streaming: false,
  linkify: true,
  breaks: true,
});

const md = new MarkdownIt({
  html: false, // 防范 XSS 注入
  linkify: props.linkify,
  breaks: props.breaks,
  typographer: false,
});

const renderedHtml = computed(() => {
  if (!props.content) return "";
  return md.render(props.content);
});
</script>

<template>
  <div class="va-md" :data-streaming="streaming || undefined">
    <div class="va-md__body" v-html="renderedHtml" />
    <span v-if="streaming" class="va-md__caret" aria-hidden="true" />
  </div>
</template>

<style src="./VaMarkdown.css"></style>
