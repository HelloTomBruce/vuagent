<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { ComboboxEvents, ComboboxProps } from "./types";
import { useCombobox } from "./useCombobox";

const props = defineProps<ComboboxProps>();

const emit = defineEmits<ComboboxEvents>();

const inputEl = useTemplateRef<HTMLInputElement>("input");
const { query, open, activeIdx, selected, items, openMenu, close, pick, onInputKeydown } = useCombobox(
  props,
  inputEl,
  {
    "update:modelValue": (v) => emit("update:modelValue", v),
    create: (v) => emit("create", v),
    select: (o) => emit("select", o),
  },
);

/** 关闭态回填：优先选中项 label；creatable 新值不在 options 里则回显值本身 */
const displayValue = computed(() => selected.value?.label ?? props.modelValue ?? "");
</script>

<template>
  <div class="va-cbx">
    <input
      ref="input"
      class="va-cbx__input"
      type="text"
      role="combobox"
      :value="open ? query : displayValue"
      :aria-expanded="open"
      aria-controls="va-cbx-list"
      :aria-activedescendant="open && items[activeIdx] ? `va-cbx-opt-${activeIdx}` : undefined"
      :aria-label="props.label ?? '组合选择'"
      :placeholder="props.placeholder ?? '输入搜索或选择…'"
      autocomplete="off"
      @input="query = ($event.target as HTMLInputElement).value"
      @focus="openMenu"
      @keydown="onInputKeydown"
      @blur="close()"
    >
    <span class="va-cbx__chev" aria-hidden="true" @mousedown.prevent>{{ open ? "▴" : "▾" }}</span>

    <ul
      v-if="open && items.length"
      id="va-cbx-list"
      class="va-cbx__list"
      role="listbox"
      @mousedown.prevent
    >
      <li
        v-for="(o, i) in items"
        :id="`va-cbx-opt-${i}`"
        :key="o.value"
        class="va-cbx__opt"
        role="option"
        :aria-selected="o.value === props.modelValue"
        :data-active="i === activeIdx"
        :data-disabled="o.disabled"
        @click="pick(o)"
        @mousemove="activeIdx = i"
      >
        <span class="va-cbx__label">{{ o.label }}</span>
        <span v-if="o.hint" class="va-cbx__hint">{{ o.hint }}</span>
        <span v-else-if="o.value === props.modelValue" class="va-cbx__hint">✓</span>
      </li>
    </ul>
    <div v-else-if="open" class="va-cbx__empty" @mousedown.prevent>
      {{ props.emptyLabel ?? "没有匹配项" }}
    </div>
    <p v-if="selected && !open" class="va-cbx__sr">当前选中：{{ selected.label }}</p>
  </div>
</template>

<style src="./VaCombobox.css"></style>
