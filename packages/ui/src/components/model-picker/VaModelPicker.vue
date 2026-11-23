<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { ModelItem, ModelPickerProps } from "./types";
import { useModelPicker } from "./useModelPicker";

const props = withDefaults(defineProps<ModelPickerProps>(), {
  models: undefined,
  align: "left",
  ariaLabel: "选择模型",
});

const selected = defineModel<string>("selected", { default: "" });

const root = useTemplateRef<HTMLElement>("root");
const { models, open, activeIdx, current, onTriggerClick, pick, onKeydown } = useModelPicker(props, selected, root);

interface ModelPickerGroup {
  provider: string;
  items: Array<{
    model: ModelItem;
    flatIndex: number;
  }>;
}

/** 按 Provider 组织分组（一个 Provider 下会有多个模型） */
const groups = computed<ModelPickerGroup[]>(() => {
  const result: ModelPickerGroup[] = [];
  const map = new Map<string, ModelPickerGroup>();

  models.value.forEach((m, idx) => {
    let prov = (m.provider || "").trim();
    if (!prov && m.tag && m.tag.includes("·")) {
      prov = m.tag.split("·")[0].trim();
    }
    const groupKey = prov || "默认";

    let grp = map.get(groupKey);
    if (!grp) {
      grp = { provider: groupKey, items: [] };
      map.set(groupKey, grp);
      result.push(grp);
    }
    grp.items.push({ model: m, flatIndex: idx });
  });

  return result;
});

/** 判定是否启用分组展示 */
const hasGroups = computed(() => {
  return groups.value.length > 1 || (groups.value.length === 1 && groups.value[0].provider !== "默认");
});

/** 计算右侧展示标签（展示真实模型标识） */
function displayTag(m: ModelItem, grouped: boolean): string {
  const tag = m.model || (grouped && m.tag?.includes("·") ? m.tag.split("·").slice(1).join("·").trim() : m.tag) || "";
  if (tag === m.name) return "";
  return tag;
}
</script>

<template>
  <div ref="root" class="va-mpk" @keydown="onKeydown">
    <!-- 自定义触发器（宿主注入座位样式等）；slot props: { current, open, toggle } -->
    <slot name="trigger" :current="current" :open="open" :toggle="onTriggerClick">
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
    </slot>

    <Transition name="va-mpk">
      <div v-if="open" class="va-mpk__menu" :class="`va-mpk__menu--${props.align}`" role="listbox">
        <!-- 分组展示形态（按 Provider 聚类，一个 Provider 下支持多个模型） -->
        <template v-if="hasGroups">
          <div v-for="g in groups" :key="g.provider" class="va-mpk__group">
            <div class="va-mpk__group-header">
              <span class="va-mpk__group-title">{{ g.provider }}</span>
              <span class="va-mpk__group-count">{{ g.items.length }}</span>
            </div>
            <ul class="va-mpk__list" role="group" :aria-label="g.provider">
              <li v-for="item in g.items" :key="item.model.id">
                <button
                  class="va-mpk__item"
                  :class="{
                    'va-mpk__item--active': item.flatIndex === activeIdx,
                    'va-mpk__item--selected': item.model.id === selected,
                  }"
                  type="button"
                  role="option"
                  :aria-selected="item.model.id === selected"
                  @mouseenter="activeIdx = item.flatIndex"
                  @click="pick(item.model)"
                >
                  <span class="va-mpk__check" aria-hidden="true">
                    <svg v-if="item.model.id === selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                      <path d="M5.5 12.5l4 4L18.5 8" />
                    </svg>
                  </span>
                  <span class="va-mpk__name" :title="item.model.name">{{ item.model.name }}</span>
                  <span
                    v-if="displayTag(item.model, true)"
                    class="va-mpk__tag"
                    :title="item.model.tag || item.model.model"
                  >
                    {{ displayTag(item.model, true) }}
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </template>

        <!-- 扁平无 Provider 时的回退单列表展示 -->
        <template v-else>
          <ul class="va-mpk__list" role="listbox">
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
                <span class="va-mpk__name" :title="m.name">{{ m.name }}</span>
                <span v-if="displayTag(m, false)" class="va-mpk__tag" :title="m.tag || m.model">
                  {{ displayTag(m, false) }}
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style src="./VaModelPicker.css"></style>
