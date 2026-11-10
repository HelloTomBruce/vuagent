<script setup lang="ts">
import { computed } from "vue";
import type { NotificationStackEvents, NotificationStackProps } from "./types";
import { formatRelative } from "../checkpoint-list/useCheckpointList";
import { useNow } from "../../composables/useNow";

const props = withDefaults(defineProps<NotificationStackProps>(), { relativeTime: true });

const emit = defineEmits<NotificationStackEvents>();

const alive = computed(() => props.notifications.length > 0);
const now = useNow(30_000, alive);

const unread = computed(() => props.notifications.filter((n) => n.unread).length);

const ICON: Record<string, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  danger: "✕",
  agent: "✦",
};

function onOpen(id: string) {
  const item = props.notifications.find((n) => n.id === id);
  if (!item) return;
  if (item.unread) emit("read", id);
  emit("open", item);
}
</script>

<template>
  <section class="va-ns" :aria-label="props.title ?? '通知'">
    <header class="va-ns__head">
      <h3 class="va-ns__title">
        {{ props.title ?? "通知" }}
        <span v-if="unread" class="va-ns__count">{{ unread }}</span>
      </h3>
      <button
        v-if="unread"
        class="va-ns__allread"
        type="button"
        @click="emit('allRead')"
      >全部已读</button>
    </header>

    <p v-if="!props.notifications.length" class="va-ns__empty">{{ props.emptyLabel ?? "没有新通知" }}</p>
    <ul
      v-else
      class="va-ns__list"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
    >
      <li
        v-for="n in props.notifications"
        :key="n.id"
        class="va-ns__item"
        :data-kind="n.kind ?? 'info'"
        :data-unread="n.unread ?? false"
      >
        <button class="va-ns__main" type="button" @click="onOpen(n.id)">
          <span class="va-ns__icon" aria-hidden="true">{{ ICON[n.kind ?? "info"] }}</span>
          <span class="va-ns__text">
            <span class="va-ns__t">{{ n.title }}</span>
            <span v-if="n.body" class="va-ns__b">{{ n.body }}</span>
            <span v-if="n.createdAt && props.relativeTime" class="va-ns__time">
              {{ formatRelative(n.createdAt, now) }}
            </span>
          </span>
        </button>
        <span v-if="n.unread" class="va-ns__dot" aria-label="未读" />
      </li>
    </ul>
  </section>
</template>

<style src="./VaNotificationStack.css"></style>
