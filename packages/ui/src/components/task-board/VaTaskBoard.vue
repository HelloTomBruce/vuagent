<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskBoardEvents, TaskBoardProps } from "./types";
import type { BoardTask } from "./types";

const props = defineProps<TaskBoardProps>();

const emit = defineEmits<TaskBoardEvents>();

const touched = ref(false);
const inner = ref<string | undefined>(props.defaultSelected);
const selectedId = computed(() =>
  props.selected !== undefined || touched.value ? props.selected : inner.value,
);

const byColumn = (colId: string) => props.tasks.filter((t) => t.columnId === colId);

function open(task: BoardTask) {
  touched.value = true;
  inner.value = task.id;
  emit("update:selected", task.id);
  emit("open", task);
}
</script>

<template>
  <div class="va-board" role="list" aria-label="任务看板">
    <section v-for="col in props.columns" :key="col.id" class="va-board__col" :aria-label="col.title">
      <header class="va-board__col-head">
        <span class="va-board__col-title">{{ col.title }}</span>
        <span class="va-board__count">{{ col.hint ?? byColumn(col.id).length }}</span>
      </header>
      <div class="va-board__cards">
        <p v-if="!byColumn(col.id).length" class="va-board__none">空</p>
        <button
          v-for="t in byColumn(col.id)"
          :key="t.id"
          class="va-board__card"
          type="button"
          :data-selected="t.id === selectedId"
          @click="open(t)"
        >
          <span class="va-board__card-title">{{ t.title }}</span>
          <span class="va-board__card-foot">
            <span v-if="t.priority" class="va-board__prio" :data-priority="t.priority" :aria-label="`优先级：${t.priority}`" />
            <span v-if="t.meta" class="va-board__meta">{{ t.meta }}</span>
            <span v-if="t.assignee" class="va-board__assignee" :aria-label="`负责人 ${t.assignee}`">{{ t.assignee.slice(0, 1) }}</span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style src="./VaTaskBoard.css"></style>
