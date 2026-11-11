<script setup lang="ts">
import type { MemoryItem, MemoryPanelProps } from "./types";
import { useMemoryPanel } from "./useMemoryPanel";

const props = withDefaults(defineProps<MemoryPanelProps>(), {
  title: "助手记住的",
  undoMs: 6000,
});

const enabled = defineModel<boolean>("enabled", { default: true });

const emit = defineEmits<{
  edit: [id: string, text: string];
  pause: [id: string, paused: boolean];
  forget: [id: string];
  restore: [items: MemoryItem[]];
}>();

const {
  filter,
  categories,
  visible,
  editingId,
  draft,
  startEdit,
  saveEdit,
  tray,
  forget,
  undoForget,
  togglePause,
} = useMemoryPanel(props, {
  edit: (id, text) => emit("edit", id, text),
  pause: (id, paused) => emit("pause", id, paused),
  forget: (id) => emit("forget", id),
  restore: (items) => emit("restore", items),
});
</script>

<template>
  <div class="va-mem" :data-off="!enabled || undefined">
    <header class="va-mem__head">
      <h4 class="va-mem__title">{{ props.title }}</h4>
      <button
        class="va-mem__switch"
        type="button"
        role="switch"
        :aria-checked="enabled"
        :aria-label="enabled ? '关闭记忆' : '开启记忆'"
        @click="enabled = !enabled"
      >
        <span class="va-mem__knob" />
      </button>
    </header>

    <template v-if="enabled">
      <div v-if="props.memories.length" class="va-mem__filters" role="tablist" aria-label="记忆分类过滤">
        <button
          class="va-mem__chip"
          :class="{ 'va-mem__chip--on': filter === '__all' }"
          type="button"
          role="tab"
          :aria-selected="filter === '__all'"
          @click="filter = '__all'"
        >全部 {{ props.memories.length }}</button>
        <button
          class="va-mem__chip"
          :class="{ 'va-mem__chip--on': filter === '__paused' }"
          type="button"
          role="tab"
          :aria-selected="filter === '__paused'"
          @click="filter = '__paused'"
        >已暂停 {{ props.memories.filter((m) => m.paused).length }}</button>
        <button
          v-for="[cat, n] in categories"
          :key="cat"
          class="va-mem__chip"
          :class="{ 'va-mem__chip--on': filter === cat }"
          type="button"
          role="tab"
          :aria-selected="filter === cat"
          @click="filter = cat"
        >{{ cat }} {{ n }}</button>
      </div>

      <TransitionGroup tag="ul" class="va-mem__list" name="va-mem">
        <li v-for="m in visible" :key="m.id" class="va-mem__row" :data-paused="m.paused || undefined">
          <span class="va-mem__cat">{{ m.category }}</span>

          <input
            v-if="editingId === m.id"
            v-model="draft"
            class="va-mem__input"
            type="text"
            @keydown.enter="saveEdit(m)"
            @keydown.esc="editingId = null"
            @blur="saveEdit(m)"
          />
          <button v-else class="va-mem__text" type="button" title="点击编辑" @click="startEdit(m)">{{ m.text }}</button>

          <span class="va-mem__ops">
            <button
              class="va-act va-act--ghost va-mem__op"
              type="button"
              :aria-label="m.paused ? '恢复' : '暂停'"
              :data-on="m.paused || undefined"
              @click="togglePause(m)"
            >{{ m.paused ? "▶" : "⏸" }}</button>
            <button class="va-act va-act--ghost va-mem__op va-mem__op--danger" type="button" aria-label="遗忘" @click="forget(m)">✕</button>
          </span>
        </li>
      </TransitionGroup>

      <p v-if="!visible.length" class="va-mem__empty">这个过滤条件下没有记忆。</p>

      <Transition name="va-mem-tray">
        <div v-if="tray.length" class="va-mem__tray" role="status">
          <span>已遗忘 {{ tray.length }} 条记忆</span>
          <button class="va-mem__undo" type="button" @click="undoForget">撤销</button>
        </div>
      </Transition>
    </template>

    <p v-else class="va-mem__off-hint">记忆已关闭——助手不会再记住或引用你的信息。</p>
  </div>
</template>

<style src="./VaMemoryPanel.css"></style>
