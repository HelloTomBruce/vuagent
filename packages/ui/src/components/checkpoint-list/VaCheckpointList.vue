<script setup lang="ts">
import { computed } from "vue";
import type { CheckpointListEvents, CheckpointListProps } from "./types";
import type { Checkpoint } from "./types";
import { formatRelative, useConfirmArmed } from "./useCheckpointList";
import { useNow } from "../../composables/useNow";

const props = defineProps<CheckpointListProps>();

const emit = defineEmits<CheckpointListEvents>();

// 列表非空时 30s 心跳刷新相对时间
const alive = computed(() => props.checkpoints.length > 0);
const now = useNow(30_000, alive);
const { armed, arm } = useConfirmArmed();

const timeOf = (c: Checkpoint) => (c.createdAt ? formatRelative(c.createdAt, now.value) : "");

const summaryOf = (c: Checkpoint) => {
  if (c.summary) return c.summary;
  const parts: string[] = [];
  if (c.files) parts.push(`${c.files} 个文件`);
  if (c.additions) parts.push(`+${c.additions}`);
  if (c.deletions) parts.push(`−${c.deletions}`);
  return parts.join(" · ");
};

/** 恢复：首次点击进入确认态，3s 内再点才真正 emit */
function onRestore(id: string) {
  if (props.confirmLabel === "") {
    emit("restore", id);
    return;
  }
  if (armed.value === id) {
    arm(null);
    emit("restore", id);
  } else {
    arm(id);
  }
}
</script>

<template>
  <div class="va-ckpt">
    <div
      class="va-ckpt__list"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
    >
      <p v-if="!props.checkpoints.length" class="va-ckpt__empty">还没有检查点。</p>
      <div
        v-for="c in props.checkpoints"
        :key="c.id"
        class="va-ckpt__item"
        :class="{ 'va-ckpt__item--current': c.current, 'va-ckpt__item--restoring': props.restoring === c.id }"
      >
        <span class="va-ckpt__pin" aria-hidden="true" />
        <div class="va-ckpt__main">
          <div class="va-ckpt__line">
            <span class="va-ckpt__label">{{ c.label }}</span>
            <span v-if="c.current" class="va-ckpt__badge">当前</span>
          </div>
          <div class="va-ckpt__meta">
            <span v-if="summaryOf(c)" class="va-ckpt__sum">{{ summaryOf(c) }}</span>
            <span v-if="c.createdAt" class="va-ckpt__time">{{ timeOf(c) }}</span>
          </div>
        </div>
        <div class="va-ckpt__ops">
          <button class="va-ckpt__btn" type="button" @click="emit('preview', c.id)">diff</button>
          <button
            v-if="!c.current"
            class="va-ckpt__btn va-ckpt__btn--restore"
            type="button"
            :disabled="props.restoring !== undefined"
            :data-armed="armed === c.id"
            @click="onRestore(c.id)"
          >
            <template v-if="props.restoring === c.id">恢复中…</template>
            <template v-else-if="armed === c.id">{{ props.confirmLabel || "确认恢复？" }}</template>
            <template v-else>恢复</template>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style src="./VaCheckpointList.css"></style>
