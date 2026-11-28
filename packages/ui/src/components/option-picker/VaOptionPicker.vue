<script setup lang="ts">
/**
 * VaOptionPicker（0.9.0 W3）：ui_option_picker 的渲染组件（L2 方案拍板）。
 * 单选=radio 组、多选=checkbox 组；recommended 徽标 + description 展开。
 * 提交契约：selected 恒为 string[]（单选长度 1，与派生 resultSchema 同口径）。
 */
import { computed, ref } from "vue";

interface OptionItem {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    options?: OptionItem[];
    multiple?: boolean;
    submitLabel?: string;
    disabled?: boolean;
    /** 422 fieldErrors（{path,message}[]）：就地回显供重填 */
    fieldErrors?: Array<{ path: string; message: string }>;
  }>(),
  {
    title: "请选择",
    description: undefined,
    options: () => [],
    multiple: false,
    submitLabel: "确认选择",
    disabled: false,
    fieldErrors: undefined,
  }
);

const emit = defineEmits<{
  (e: "submit", selected: string[]): void;
  (e: "cancel"): void;
}>();

/** 单选存 string、多选存 string[]——内部统一数组，提交时原样（单选长度 1） */
const selected = ref<string[]>([]);

const validOptions = computed(() =>
  (props.options || []).filter((o) => o && typeof o.id === "string" && typeof o.label === "string")
);

const canSubmit = computed(() => !props.disabled && selected.value.length > 0);

function toggle(id: string) {
  if (props.disabled) return;
  if (props.multiple) {
    const idx = selected.value.indexOf(id);
    if (idx >= 0) selected.value.splice(idx, 1);
    else selected.value.push(id);
  } else {
    selected.value = [id];
  }
}
</script>

<template>
  <div class="va-option-picker" data-testid="va-option-picker">
    <div class="va-option-picker__head">
      <div class="va-option-picker__title">{{ title }}</div>
      <span v-if="multiple" class="va-option-picker__mode-chip">可多选</span>
    </div>
    <p v-if="description" class="va-option-picker__desc">{{ description }}</p>

    <div class="va-option-picker__list" role="listbox" :aria-multiselectable="multiple">
      <button
        v-for="opt in validOptions"
        :key="opt.id"
        type="button"
        class="va-option-picker__item"
        :class="{ 'va-option-picker__item--active': selected.includes(opt.id) }"
        :aria-selected="selected.includes(opt.id)"
        :disabled="disabled"
        @click="toggle(opt.id)"
      >
        <span class="va-option-picker__mark">{{ selected.includes(opt.id) ? "◉" : "○" }}</span>
        <span class="va-option-picker__body">
          <span class="va-option-picker__label">
            {{ opt.label }}
            <span v-if="opt.recommended" class="va-option-picker__badge">推荐</span>
          </span>
          <span v-if="opt.description" class="va-option-picker__opt-desc">{{ opt.description }}</span>
        </span>
      </button>
    </div>

    <div v-if="fieldErrors?.length" class="va-option-picker__errors" role="alert">
      <div v-for="(fe, i) in fieldErrors" :key="i" class="va-option-picker__error">⚠ {{ fe.path }}：{{ fe.message }}</div>
    </div>

    <div class="va-option-picker__foot">
      <button class="va-option-picker__btn" type="button" :disabled="!canSubmit" @click="emit('submit', [...selected])">
        {{ submitLabel }}
      </button>
      <button class="va-option-picker__btn va-option-picker__btn--ghost" type="button" :disabled="disabled" @click="emit('cancel')">
        取消
      </button>
    </div>
  </div>
</template>

<style scoped>
.va-option-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.va-option-picker__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.va-option-picker__title {
  font-weight: 600;
  font-size: 14px;
}
.va-option-picker__mode-chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--va-accent-soft, rgba(194, 65, 12, 0.1));
  color: var(--va-accent, #c2410c);
}
.va-option-picker__desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--va-muted, #6f6d66);
}
.va-option-picker__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.va-option-picker__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--va-dur-1, 120ms), background var(--va-dur-1, 120ms);
}
.va-option-picker__item:hover:not(:disabled) {
  border-color: var(--va-accent, #c2410c);
}
.va-option-picker__item--active {
  border-color: var(--va-accent, #c2410c);
  background: var(--va-accent-soft, rgba(194, 65, 12, 0.1));
}
.va-option-picker__mark {
  color: var(--va-accent, #c2410c);
  font-size: 14px;
  line-height: 1.4;
}
.va-option-picker__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.va-option-picker__label {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}
.va-option-picker__badge {
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--va-accent, #c2410c);
  color: #fff;
}
.va-option-picker__opt-desc {
  font-size: 12px;
  color: var(--va-muted, #6f6d66);
}
.va-option-picker__errors {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--va-danger, #d5453c);
  border-radius: 6px;
  background: rgba(213, 69, 60, 0.08);
}
.va-option-picker__error {
  font-size: 12px;
  color: var(--va-danger, #d5453c);
}
.va-option-picker__foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.va-option-picker__btn {
  padding: 6px 14px;
  border: 1px solid var(--va-accent, #c2410c);
  border-radius: 6px;
  background: var(--va-accent, #c2410c);
  color: #fff;
  font-size: 12.5px;
  cursor: pointer;
}
.va-option-picker__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.va-option-picker__btn--ghost {
  background: transparent;
  color: var(--va-muted, #6f6d66);
  border-color: var(--va-edge, rgba(26, 25, 23, 0.12));
}
</style>
