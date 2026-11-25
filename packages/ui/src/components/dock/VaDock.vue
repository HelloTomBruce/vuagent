<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Columns2, Maximize2, Minimize2, Minus, Plus, Square, X } from "lucide-vue-next";
import type { DockEvents, DockProps } from "./types";

const props = withDefaults(defineProps<DockProps>(), {
  ratio: 0.55,
  fullscreenPane: null,
  addDisabled: false,
  splitDisabled: false,
});

const emit = defineEmits<DockEvents>();

const isSplit = computed(() => props.panes.length > 1);
const fullscreen = computed(() => props.fullscreenPane ?? null);

/* 分隔条拖动：受控值本地镜像，拖动中实时 emit */
const localRatio = ref(props.ratio);
watch(
  () => props.ratio,
  (r) => (localRatio.value = r),
);
const dockEl = ref<HTMLElement | null>(null);
function onDividerDown(e: PointerEvent) {
  const el = dockEl.value;
  if (!el) return;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const rect = el.getBoundingClientRect();
    const r = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
    localRatio.value = r;
    emit("resize", Math.round(r * 100) / 100);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

const splitStyle = computed(() =>
  isSplit.value && fullscreen.value === null
    ? { gridTemplateColumns: `minmax(0, ${localRatio.value}fr) 5px minmax(0, ${1 - localRatio.value}fr)` }
    : undefined,
);

function selectPane(i: number, id: string) {
  if (id !== props.panes[i]!.activeId) emit("select", i, id);
}
function toggleSplit() {
  if (isSplit.value) emit("unsplit");
  else emit("split");
}
</script>

<template>
  <div
    ref="dockEl"
    class="va-dock"
    :data-fullscreen="fullscreen !== null || undefined"
    :data-split="isSplit || undefined"
    :style="splitStyle"
  >
    <section
      v-for="(pane, i) in props.panes"
      v-show="fullscreen === null || fullscreen === i"
      :key="i"
      class="va-dock__pane va-enter-up"
    >
      <div class="va-dock__tabs">
        <button
          v-for="tab in pane.tabs"
          :key="tab.id"
          class="va-dock__tab"
          type="button"
          :data-active="tab.id === pane.activeId || undefined"
          @click="selectPane(i, tab.id)"
        >
          <component :is="tab.icon" v-if="tab.icon" :size="12" aria-hidden="true" />
          <span class="va-dock__tab-label">{{ tab.label ?? tab.id }}</span>
          <span
            v-if="tab.closable !== false"
            class="va-dock__tabx"
            role="button"
            tabindex="0"
            aria-label="关闭面板"
            @click.stop="emit('close', i, tab.id)"
            @keydown.enter.prevent="emit('close', i, tab.id)"
          ><X :size="11" aria-hidden="true" /></span>
        </button>

        <button
          class="va-dock__op va-dock__op--add"
          type="button"
          aria-label="添加面板"
          :disabled="props.addDisabled"
          @click="emit('add', i)"
        ><Plus :size="13" aria-hidden="true" /></button>

        <span class="va-dock__spacer" />

        <!-- 全局操作挂在最后一个可见 pane 的 tab 条尾部 -->
        <template v-if="i === (fullscreen ?? props.panes.length - 1)">
          <button v-if="!props.splitDisabled" class="va-dock__op" type="button" :aria-label="isSplit ? '取消分屏' : '分屏'" @click="toggleSplit">
            <Columns2 v-show="!isSplit" :size="13" aria-hidden="true" />
            <Square v-show="isSplit" :size="11" aria-hidden="true" />
          </button>
          <button
            v-if="fullscreen === null && isSplit"
            class="va-dock__op"
            type="button"
            :aria-label="`全屏面板 ${i + 1}`"
            @click="emit('fullscreen', i)"
          ><Maximize2 :size="13" aria-hidden="true" /></button>
          <button v-if="fullscreen !== null" class="va-dock__op" type="button" aria-label="退出全屏" @click="emit('fullscreen', null)">
            <Minimize2 :size="13" aria-hidden="true" />
          </button>
          <button class="va-dock__op" type="button" aria-label="收起面板区" @click="emit('collapse')">
            <Minus :size="13" aria-hidden="true" />
          </button>
        </template>
      </div>

      <div class="va-dock__body">
        <slot name="pane" :pane-index="i" :tab-id="pane.activeId">
          <p v-if="!pane.tabs.length" class="va-dock__empty va-fade-in">没有打开的面板，点「＋」添加。</p>
        </slot>
      </div>
    </section>

    <div
      v-if="isSplit && fullscreen === null"
      class="va-dock__divider"
      role="separator"
      aria-label="拖动调整分屏宽度"
      @pointerdown.prevent="onDividerDown"
    />
  </div>
</template>

<style src="./VaDock.css"></style>
