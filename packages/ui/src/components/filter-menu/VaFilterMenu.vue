<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import type { FilterMenuEvents, FilterMenuProps, FilterValue } from "./types";

const props = defineProps<FilterMenuProps>();

const emit = defineEmits<FilterMenuEvents>();

/* 受控优先，哨兵回落 defaultValue */
const touched = ref(false);
const inner = ref<FilterValue>(props.defaultValue ?? {});
const value = computed<FilterValue>(() =>
  props.modelValue !== undefined || touched.value ? (props.modelValue ?? {}) : inner.value,
);

const open = ref(false);
const rootEl = useTemplateRef<HTMLElement>("root");

const activeCount = computed(() => {
  let n = 0;
  for (const g of props.groups) {
    const v = value.value[g.id];
    if (Array.isArray(v)) n += v.length;
    else if (v !== undefined && v !== "") n++;
  }
  return n;
});

function toggleCheckbox(groupId: string, opt: string) {
  const cur = Array.isArray(value.value[groupId]) ? ([...value.value[groupId]] as string[]) : [];
  const idx = cur.indexOf(opt);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(opt);
  set(groupId, cur);
}

function setRadio(groupId: string, opt: string, current: string | string[] | undefined) {
  set(groupId, current === opt ? "" : opt);
}

function set(groupId: string, v: string[] | string) {
  const next = { ...value.value, [groupId]: v };
  touched.value = true;
  inner.value = next;
  emit("update:modelValue", next);
}

function clearAll() {
  touched.value = true;
  inner.value = {};
  emit("update:modelValue", {});
  emit("clear");
}

function toggle() {
  open.value = !open.value;
}

const onDocMousedown = (e: MouseEvent) => {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false;
};
onMounted(() => {
  if (typeof document !== "undefined") document.addEventListener("mousedown", onDocMousedown);
});
onBeforeUnmount(() => {
  if (typeof document !== "undefined") document.removeEventListener("mousedown", onDocMousedown);
});

const checked = (groupId: string, opt: string) => {
  const v = value.value[groupId];
  return Array.isArray(v) ? v.includes(opt) : v === opt;
};
</script>

<template>
  <div ref="root" class="va-fm">
    <button
      class="va-fm__trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="toggle"
      @keydown.escape.prevent="open = false"
    >
      {{ props.triggerLabel ?? "筛选" }}
      <span v-if="activeCount" class="va-fm__count">{{ activeCount }}</span>
    </button>

    <div v-if="open" class="va-fm__panel" role="group" :aria-label="props.triggerLabel ?? '筛选'">
      <section v-for="g in props.groups" :key="g.id" class="va-fm__group">
        <h4 class="va-fm__label">{{ g.label }}</h4>
        <div class="va-fm__opts">
          <label v-for="opt in g.options" :key="opt.value" class="va-fm__opt">
            <input
              class="va-fm__box"
              :type="g.type === 'radio' ? 'radio' : 'checkbox'"
              :name="`va-fm-${g.id}`"
              :checked="checked(g.id, opt.value)"
              @change="g.type === 'radio' ? setRadio(g.id, opt.value, value[g.id]) : toggleCheckbox(g.id, opt.value)"
            >
            <span>{{ opt.label }}</span>
          </label>
        </div>
      </section>
      <footer class="va-fm__foot">
        <button class="va-fm__clear" type="button" :disabled="!activeCount" @click="clearAll">清除全部</button>
      </footer>
    </div>
  </div>
</template>

<style src="./VaFilterMenu.css"></style>
