<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { ModelPickerProps } from "./types";
import { useModelPicker } from "./useModelPicker";

const props = withDefaults(defineProps<ModelPickerProps>(), {
  models: undefined,
  align: "left",
  ariaLabel: "选择模型",
});

const selected = defineModel<string>("selected", { default: "" });

const root = useTemplateRef<HTMLElement>("root");
const { models, open, activeIdx, current, onTriggerClick, pick, onKeydown } = useModelPicker(props, selected, root);
</script>

<template>
  <div ref="root" class="va-mpk" @keydown="onKeydown">
    <button
      class="va-mpk__btn"
      type="button"
      :aria-expanded="open"
      :aria-label="props.ariaLabel"
      @click="onTriggerClick"
    >
      {{ current?.name ?? "选择模型" }}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="m7 9.5 5 5 5-5" />
      </svg>
    </button>

    <Transition name="va-mpk">
      <ul v-if="open" class="va-mpk__menu" :class="`va-mpk__menu--${props.align}`" role="listbox">
        <li v-for="(m, i) in models" :key="m.id">
          <button
            class="va-mpk__item"
            :class="{ 'va-mpk__item--active': i === activeIdx, 'va-mpk__item--selected': m.id === selected }"
            type="button"
            role="option"
            :aria-selected="m.id === selected"
            @mouseenter="activeIdx = i"
            @click="pick(m)"
          >
            <span class="va-mpk__check" aria-hidden="true">
              <svg v-if="m.id === selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <path d="M5.5 12.5l4 4L18.5 8" />
              </svg>
            </span>
            {{ m.name }}
            <span v-if="m.tag" class="va-mpk__tag">{{ m.tag }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style src="./VaModelPicker.css"></style>
