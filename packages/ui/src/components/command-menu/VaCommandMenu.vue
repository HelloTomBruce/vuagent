<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { CommandMenuEvents, CommandMenuProps } from "./types";
import { useCommandMenu } from "./useCommandMenu";

const props = defineProps<CommandMenuProps>();

const emit = defineEmits<CommandMenuEvents>();

const inputEl = useTemplateRef<HTMLInputElement>("input");
const panelEl = useTemplateRef<HTMLElement>("panel");

const {
  isOpen,
  openMenu,
  query,
  flat,
  groups,
  activeIdx,
  onInputKeydown,
  trapTab,
  onBackdropClick,
  pick,
} = useCommandMenu(props, inputEl, panelEl, {
  "update:open": (v) => emit("update:open", v),
  select: (item) => emit("select", item),
});

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openMenu();
  }
}
</script>

<template>
  <span class="va-cmd">
    <button
      class="va-cmd__trigger"
      type="button"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      @click="openMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="va-cmd__icon" aria-hidden="true">⌘</span>
      {{ props.triggerLabel ?? "命令" }}
      <kbd v-if="props.hotkey" class="va-cmd__kbd">{{ props.hotkey }}</kbd>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        class="va-cmd__backdrop"
        @click="onBackdropClick"
        @keydown="trapTab"
      />
      <div
        v-if="isOpen"
        ref="panel"
        class="va-cmd__panel"
        role="dialog"
        aria-modal="true"
        :aria-label="'命令面板'"
        :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
      >
        <div class="va-cmd__search">
          <span class="va-cmd__mag" aria-hidden="true">⌕</span>
          <input
            ref="input"
            v-model="query"
            class="va-cmd__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="va-cmd-list"
            :aria-activedescendant="flat[activeIdx] ? `va-cmd-opt-${flat[activeIdx]!.id}` : undefined"
            :placeholder="props.placeholder ?? '输入命令或搜索…'"
            aria-label="搜索命令"
            autocomplete="off"
            @keydown="onInputKeydown"
          >
          <kbd class="va-cmd__kbd va-cmd__kbd--fixed">esc</kbd>
        </div>

        <div id="va-cmd-list" class="va-cmd__list" role="listbox" aria-label="命令列表">
          <p v-if="!flat.length" class="va-cmd__empty">{{ props.emptyLabel ?? "没有匹配的命令" }}</p>
          <template v-for="g in groups" :key="g.group ?? ''">
            <div v-if="g.group" class="va-cmd__group" aria-hidden="true">{{ g.group }}</div>
            <button
              v-for="item in g.items"
              :id="`va-cmd-opt-${item.id}`"
              :key="item.id"
              class="va-cmd__item"
              type="button"
              role="option"
              :aria-selected="flat[activeIdx]?.id === item.id"
              :aria-disabled="item.disabled"
              :data-active="flat[activeIdx]?.id === item.id"
              :data-danger="item.danger"
              :disabled="item.disabled"
              @click="pick(item)"
              @mousemove="activeIdx = flat.findIndex((x) => x.id === item.id)"
            >
              <span class="va-cmd__label">{{ item.label }}</span>
              <kbd v-if="item.hint" class="va-cmd__kbd">{{ item.hint }}</kbd>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<style src="./VaCommandMenu.css"></style>
