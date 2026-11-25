<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { VaPopover } from "../popover";
import type { SelectEvents, SelectProps, SelectSlots } from "./types";
import { useSelect } from "./useSelect";

/**
 * VaSelect — 纯选择型下拉（单选/多选/可搜索/可清除）。
 * 触发器是 button 形态（role=combobox）；弹层复用 VaPopover
 * （matchAnchorWidth + bottom-start + 外部点击/Esc 关闭）。
 */

const props = withDefaults(defineProps<SelectProps>(), {
  placeholder: "请选择",
  emptyLabel: "无匹配项",
  size: "md",
});
const emit = defineEmits<SelectEvents>();
defineSlots<SelectSlots>();

const triggerEl = useTemplateRef<HTMLButtonElement>("trigger");
const searchEl = useTemplateRef<HTMLInputElement>("search");

const {
  listId,
  open,
  query,
  activeIdx,
  values,
  selectedOptions,
  hasValue,
  isSelected,
  flatItems,
  renderEntries,
  showClear,
  activeDomId,
  setOpen,
  pick,
  onClear,
  onTriggerKeydown,
  onTriggerKeyup,
  onSearchKeydown,
} = useSelect(
  props,
  { trigger: triggerEl, search: searchEl },
  {
    "update:modelValue": (v) => emit("update:modelValue", v),
    change: (v, o) => emit("change", v, o),
    clear: () => emit("clear"),
    visibleChange: (v) => emit("visibleChange", v),
  },
);

/** 回显文本：label 优先，options 里找不到的值回显原始 value */
const displayText = computed(() => {
  const labelOf = (v: string) => props.options.find((o) => o.value === v)?.label ?? v;
  return values.value.map(labelOf).join("、");
});

const rootClass = computed(() => [
  "va-sel",
  `va-sel--${props.size}`,
  {
    "va-sel--open": open.value,
    "va-sel--disabled": props.disabled,
    "va-sel--invalid": props.invalid,
    "va-sel--multiple": props.multiple,
  },
]);
</script>

<template>
  <VaPopover
    :open="open"
    :disabled="props.disabled"
    match-anchor-width
    placement="bottom-start"
    @update:open="setOpen"
  >
    <template #trigger>
      <span
        :class="rootClass"
        :data-disabled="props.disabled || undefined"
        :data-loading="props.loading || undefined"
        :data-clearable="showClear || undefined"
      >
        <button
          ref="trigger"
          type="button"
          class="va-sel__trigger"
          role="combobox"
          :aria-expanded="open"
          aria-haspopup="listbox"
          :aria-controls="listId"
          :aria-invalid="props.invalid || undefined"
          :aria-label="props.label ?? '选择'"
          :aria-activedescendant="!props.searchable ? activeDomId : undefined"
          :disabled="props.disabled"
          @keydown="onTriggerKeydown"
          @keyup="onTriggerKeyup"
        >
          <span class="va-sel__value" :data-placeholder="!hasValue || undefined">
            <slot name="value" :options="selectedOptions" :values="values">
              {{ hasValue ? displayText : props.placeholder }}
            </slot>
          </span>
          <span class="va-sel__indicators" aria-hidden="true">
            <span v-if="props.loading" class="va-sel__spinner" />
            <svg v-else class="va-sel__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
        <button
          v-if="showClear"
          type="button"
          class="va-sel__clear"
          aria-label="清除选择"
          title="清除"
          @click="onClear"
          @mousedown.stop
        >
          ×
        </button>
      </span>
    </template>

    <div class="va-sel__panel">
      <div v-if="props.searchable" class="va-sel__search">
        <input
          ref="search"
          v-model="query"
          type="text"
          class="va-sel__search-input"
          placeholder="搜索…"
          aria-label="搜索选项"
          :aria-controls="listId"
          :aria-activedescendant="props.searchable ? activeDomId : undefined"
          autocomplete="off"
          @keydown="onSearchKeydown"
        >
      </div>

      <div
        v-if="flatItems.length"
        :id="listId"
        class="va-sel__list"
        role="listbox"
        :aria-multiselectable="props.multiple || undefined"
        :aria-label="props.label ?? '选项列表'"
        @mousedown.prevent
      >
        <template
          v-for="entry in renderEntries"
          :key="entry.type === 'group' ? entry.titleId : `plain-${entry.items[0]?.index ?? 0}`"
        >
          <div
            v-if="entry.type === 'group'"
            class="va-sel__group"
            role="group"
            :aria-labelledby="entry.titleId"
          >
            <div :id="entry.titleId" class="va-sel__group-title">{{ entry.label }}</div>
            <div
              v-for="it in entry.items"
              :id="it.domId"
              :key="it.domId"
              class="va-sel__opt"
              role="option"
              :aria-selected="isSelected(it.option)"
              :aria-disabled="it.option.disabled || undefined"
              :data-active="it.index === activeIdx || undefined"
              @click="pick(it.option)"
              @mousemove="!it.option.disabled && (activeIdx = it.index)"
            >
              <span
                v-if="props.multiple"
                class="va-sel__check"
                :data-checked="isSelected(it.option) || undefined"
                aria-hidden="true"
              />
              <span class="va-sel__opt-main">
                <slot
                  name="option"
                  :option="it.option"
                  :selected="isSelected(it.option)"
                  :active="it.index === activeIdx"
                >
                  <span class="va-sel__opt-label">{{ it.option.label }}</span>
                  <span v-if="it.option.description" class="va-sel__opt-desc">{{ it.option.description }}</span>
                </slot>
              </span>
              <span v-if="!props.multiple && isSelected(it.option)" class="va-sel__opt-tick" aria-hidden="true">✓</span>
            </div>
          </div>
          <div
            v-for="it in entry.type === 'plain' ? entry.items : []"
            :id="it.domId"
            :key="it.domId"
            class="va-sel__opt"
            role="option"
            :aria-selected="isSelected(it.option)"
            :aria-disabled="it.option.disabled || undefined"
            :data-active="it.index === activeIdx || undefined"
            @click="pick(it.option)"
            @mousemove="!it.option.disabled && (activeIdx = it.index)"
          >
            <span
              v-if="props.multiple"
              class="va-sel__check"
              :data-checked="isSelected(it.option) || undefined"
              aria-hidden="true"
            />
            <span class="va-sel__opt-main">
              <slot
                name="option"
                :option="it.option"
                :selected="isSelected(it.option)"
                :active="it.index === activeIdx"
              >
                <span class="va-sel__opt-label">{{ it.option.label }}</span>
                <span v-if="it.option.description" class="va-sel__opt-desc">{{ it.option.description }}</span>
              </slot>
            </span>
            <span v-if="!props.multiple && isSelected(it.option)" class="va-sel__opt-tick" aria-hidden="true">✓</span>
          </div>
        </template>
      </div>

      <div v-else class="va-sel__empty va-fade-in">
        <slot name="empty">{{ props.emptyLabel }}</slot>
      </div>
    </div>
  </VaPopover>
</template>

<style src="./VaSelect.css"></style>
