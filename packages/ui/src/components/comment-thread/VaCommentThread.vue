<script setup lang="ts">
import { useTemplateRef, ref } from "vue";
import type { CommentThreadEvents, CommentThreadProps } from "./types";
import { formatRelative } from "../checkpoint-list/useCheckpointList";
import { useNow } from "../../composables/useNow";
import { computed } from "vue";

const props = defineProps<CommentThreadProps>();

const emit = defineEmits<CommentThreadEvents>();

const alive = computed(() => props.comments.length > 0);
const now = useNow(30_000, alive);

const text = ref("");
const area = useTemplateRef<HTMLTextAreaElement>("area");

function submit() {
  const t = text.value.trim();
  if (!t || props.busy) return;
  emit("submit", t);
  text.value = "";
  requestAnimationFrame(() => area.value?.focus());
}

/** Cmd/Ctrl+Enter 发布；输入法组词中的 Enter 不拦截 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  }
}

/** 头像色块底色：按作者名 hash 到 6 个柔和色 */
const AVATAR_HUES = [16, 145, 210, 268, 34, 190];
const avatarStyle = (author: string) => ({
  background: `hsl(${AVATAR_HUES[author.length % AVATAR_HUES.length]!} 45% 88%)`,
  color: `hsl(${AVATAR_HUES[author.length % AVATAR_HUES.length]!} 45% 30%)`,
});

const initialsOf = (author: string, initials?: string) => initials ?? author.slice(0, 1).toUpperCase();
</script>

<template>
  <div class="va-cmt">
    <div
      class="va-cmt__list"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
    >
      <p v-if="!props.comments.length" class="va-cmt__empty">还没有评论，说点什么吧。</p>
      <article
        v-for="c in props.comments"
        :key="c.id"
        class="va-cmt__item"
        :class="{ 'va-cmt__item--pending': c.pending }"
      >
        <img v-if="c.avatar" class="va-cmt__avatar" :src="c.avatar" :alt="c.author" />
        <span v-else class="va-cmt__avatar va-cmt__avatar--text" :style="avatarStyle(c.author)" aria-hidden="true">
          {{ initialsOf(c.author, c.initials) }}
        </span>
        <div class="va-cmt__main">
          <header class="va-cmt__head">
            <span class="va-cmt__author">{{ c.author }}</span>
            <span v-if="c.role" class="va-cmt__role" :data-agent="c.pending ?? false">{{ c.role }}</span>
            <span v-if="c.createdAt" class="va-cmt__time">{{ formatRelative(c.createdAt, now) }}</span>
          </header>
          <p class="va-cmt__text">{{ c.text }}</p>
          <footer v-if="c.pending" class="va-cmt__pending-ops">
            <button class="va-cmt__op va-cmt__op--primary" type="button" @click="emit('adopt', c.id)">以此发布</button>
            <button class="va-cmt__op" type="button" @click="emit('rewrite', c.id)">让 agent 重写</button>
            <button class="va-cmt__op va-cmt__op--ghost" type="button" @click="emit('discard', c.id)">丢弃</button>
          </footer>
        </div>
      </article>
    </div>

    <form
      v-if="props.composer !== false"
      class="va-cmt__composer"
      @submit.prevent="submit"
    >
      <textarea
        ref="area"
        v-model="text"
        class="va-cmt__area"
        rows="1"
        :placeholder="props.placeholder ?? '写下评论…'"
        :aria-label="'评论输入'"
        @keydown="onKeydown"
      />
      <button
        class="va-cmt__send"
        type="submit"
        :disabled="!text.trim() || props.busy"
      >{{ props.busy ? "发布中…" : "发布" }}</button>
    </form>
  </div>
</template>

<style src="./VaCommentThread.css"></style>
