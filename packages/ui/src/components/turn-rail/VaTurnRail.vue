<script setup lang="ts">
/**
 * VaTurnRail —— 多轮对话右侧「快速跳转轨」（harness 客户端的 turn rail / scroll-spy 轨）。
 *
 * 解决的问题：长会话里只能靠滚动找某一轮提问。本组件在消息流右侧渲染一列轮次标记：
 * - 点击 / 回车 → 平滑定位到对应轮次锚点（容器内 [data-turn-id="<id>"]）；
 * - 阅读位置变化 → 滚动监听取当前轮次，高亮（aria-current）并填充进度轨；
 * - ↑/↓/Home/End → 在轨内移动并直接跳转（焦点跟随，纯键盘可用）；
 * - 悬停/聚焦 → 左侧预览卡显示「#N + 文案」。
 *
 * 与贴底跟随（useStickToBottom）的协作：跳转会写入 scrollTop，父级的 scroll 监听到
 * 「离底」后自然解除钉底，无需本组件额外通知；跳到底部附近父级自行恢复跟随。
 *
 * 定位方式：组件不猜 DOM 结构，锚点由消费方在轮次行上挂属性（默认 data-turn-id），
 * 与 items[].id 一一对应；找不到锚点的轮次静默跳过（只渲染标记，不可跳）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { TurnRailEvents, TurnRailProps, TurnRailItem } from "./types";

const props = withDefaults(defineProps<TurnRailProps>(), {
  items: () => [],
  container: null,
  anchorAttr: "data-turn-id",
  offset: 16,
  minItems: 1,
  preview: true,
  floating: true,
  activeId: "",
  ariaLabel: "对话轮次快速跳转",
});

const emit = defineEmits<TurnRailEvents>();

/** 锚点顶边越过容器顶边该距离即视为「当前轮」（与轮次行间距同量级） */
const SPY_TOP_PX = 96;

/**
 * 距底该距离内视为贴底（与 useStickToBottom 的 64px 阈值无关：这里只判「已到末尾」）。
 * 取 1px 而非更宽的手感值：末尾轮次的跳转常被夹到最大 scrollTop 附近，阈值放宽会把
 * 「跳到倒数第二轮、恰好离底 2px」误判成最后一轮，出现点 A 高亮 B 的错位。
 */
const BOTTOM_EPSILON_PX = 1;

const rootRef = ref<HTMLElement | null>(null);
const buttons = ref<(HTMLElement | null)[]>([]);

/** 非受控模式下的自算当前项；受控（activeId 非空）时以后者为准 */
const selfActiveId = ref("");
const activeId = computed(() => props.activeId || selfActiveId.value);
const activeIndex = computed(() => Math.max(0, props.items.findIndex((item) => item.id === activeId.value)));

/** 轮次太少时轨道只是噪音：≤ minItems 直接隐藏（minItems=0 可强制常显） */
const visible = computed(() => props.items.length > props.minItems);

/** 进度轨填充比例（当前项在轮次序列中的位置，0..1） */
const progress = computed(() => {
  const total = props.items.length;
  if (total <= 1) return 0;
  return Math.min(1, Math.max(0, activeIndex.value / (total - 1)));
});

function labelOf(item: TurnRailItem, index: number) {
  const text = (item.label ?? "").replace(/\s+/g, " ").trim();
  return text || `第 ${index + 1} 轮`;
}

/* ---------------- 锚点查找与几何 ---------------- */

/** 属性选择器取值转义（id 含引号/反斜杠时不至于拼出非法选择器） */
function escapeAttr(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

function anchorOf(id: string): HTMLElement | null {
  const el = props.container;
  if (!el) return null;
  return el.querySelector<HTMLElement>(`[${props.anchorAttr}="${escapeAttr(id)}"]`);
}

/* ---------------- 滚动跟随（scroll-spy） ---------------- */

let rafId: number | null = null;
let boundEl: HTMLElement | null = null;
let observer: ResizeObserver | null = null;

function measure() {
  const el = props.container;
  if (!el || props.items.length === 0) return;
  const containerTop = el.getBoundingClientRect().top;
  let next = props.items[0].id;
  // 贴底时直接取最后一轮：末尾轮次的锚点可能永远无法滚到阈值以内（内容不够长 /
  // 跳转被夹到最大 scrollTop），若仍按几何判定，点最后一枚标记会「点了没反应」。
  // 仅在容器确实可滚（内容超出视口）时启用：内容一屏放得下时不存在「贴底」语义，
  // 应回落到锚点几何（第一轮即当前），否则短对话一进来就高亮最后一轮。
  const scrollable = el.scrollHeight - el.clientHeight > BOTTOM_EPSILON_PX;
  if (scrollable && el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPSILON_PX) {
    next = props.items[props.items.length - 1].id;
  } else {
    for (const item of props.items) {
      const node = anchorOf(item.id);
      if (!node) continue;
      // 顺序即文档顺序：第一个尚未越过阈值的锚点之后的都不可能是「当前」
      if (node.getBoundingClientRect().top - containerTop > SPY_TOP_PX) break;
      next = item.id;
    }
  }
  if (next === selfActiveId.value) return;
  selfActiveId.value = next;
  emit("update:activeId", next);
}

function scheduleMeasure() {
  if (rafId !== null) return;
  if (typeof requestAnimationFrame !== "function") {
    measure();
    return;
  }
  rafId = requestAnimationFrame(() => {
    rafId = null;
    measure();
  });
}

function onScroll() {
  scheduleMeasure();
}

function unbind() {
  if (boundEl) boundEl.removeEventListener("scroll", onScroll);
  boundEl = null;
  observer?.disconnect();
  observer = null;
  if (rafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function bind() {
  unbind();
  const el = props.container;
  if (!el) return;
  boundEl = el;
  el.addEventListener("scroll", onScroll, { passive: true });
  // 容器高度变化（窗口缩放 / 面板拖拽）与内容增高（流式输出）都要重算当前轮；
  // 内容层通常是容器的唯一子元素，一并观察（元素盒不变也能收到内容尺寸变化）
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(el);
    const content = el.firstElementChild;
    if (content instanceof HTMLElement) observer.observe(content);
  }
  scheduleMeasure();
}

watch(() => props.container, bind, { immediate: true });
watch(
  () => props.items.map((item) => item.id).join("|"),
  () => scheduleMeasure(),
);
onBeforeUnmount(unbind);

/* ---------------- 跳转与选中 ---------------- */

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToAnchor(id: string) {
  const el = props.container;
  const node = anchorOf(id);
  if (!el || !node) return;
  const top = el.scrollTop + (node.getBoundingClientRect().top - el.getBoundingClientRect().top) - props.offset;
  const target = Math.max(0, top);
  if (typeof el.scrollTo === "function") {
    el.scrollTo({ top: target, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    return;
  }
  el.scrollTop = target; // 老宿主 / 测试替身没有 scrollTo 时退回直赋值
}

function select(item: TurnRailItem, index: number) {
  selfActiveId.value = item.id;
  emit("update:activeId", item.id);
  emit("select", item.id, index);
  scrollToAnchor(item.id);
}

/* ---------------- 键盘：轨内上下移动即跳转 ---------------- */

function setButton(el: unknown, index: number) {
  buttons.value[index] = (el as HTMLElement | null) ?? null;
}

function onKeydown(event: KeyboardEvent) {
  const total = props.items.length;
  if (total === 0) return;
  let next = -1;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = total - 1;
  else if (event.key === "ArrowUp") next = Math.max(0, activeIndex.value - 1);
  else if (event.key === "ArrowDown") next = Math.min(total - 1, activeIndex.value + 1);
  if (next < 0) return;
  event.preventDefault();
  const item = props.items[next];
  if (!item) return;
  select(item, next);
  buttons.value[next]?.focus();
}

/* ---------------- 预览卡 ---------------- */

const hoverId = ref("");
const focusId = ref("");
const previewId = computed(() => (props.preview ? hoverId.value || focusId.value : ""));
const previewItem = computed<TurnRailItem | null>(
  () => props.items.find((item) => item.id === previewId.value) ?? null,
);
const previewIndex = computed(() => props.items.findIndex((item) => item.id === previewId.value));
/** 预览卡顶边：相对轨根节点，跟随所属标记垂直居中（轨外渲染，避免被列表裁切） */
const previewTop = ref(0);

function syncPreviewTop() {
  const id = previewId.value;
  const root = rootRef.value;
  const button = buttons.value[previewIndex.value];
  if (!id || !root || !button) return;
  const anchor = button.getBoundingClientRect();
  const base = root.getBoundingClientRect();
  previewTop.value = anchor.top + anchor.height / 2 - base.top;
}

watch(previewId, async () => {
  // 预览卡是轨根节点的兄弟层，等 DOM 挂载后再量位置
  await nextTick();
  syncPreviewTop();
});

function onListScroll() {
  if (previewId.value) syncPreviewTop();
}

/* ---------------- 对外能力 ---------------- */

defineExpose({
  /** 手动重算当前轮（宿主内容变化但未触发 scroll/resize 时调用） */
  measure,
  /** 跳到某轮（等价于点击该标记） */
  scrollTo: scrollToAnchor,
  /** 当前轮次 id */
  activeId,
});
</script>

<template>
  <nav
    v-if="visible"
    ref="rootRef"
    class="va-turn-rail"
    :class="{ 'va-turn-rail--floating': props.floating }"
    :aria-label="props.ariaLabel"
    @keydown="onKeydown"
  >
    <div class="va-turn-rail__track" aria-hidden="true">
      <span class="va-turn-rail__track-fill" :style="{ transform: `scaleY(${progress})` }"></span>
    </div>

    <ol class="va-turn-rail__list" @scroll.passive="onListScroll">
      <li v-for="(item, index) in props.items" :key="item.id" class="va-turn-rail__item">
        <button
          :ref="(el) => setButton(el, index)"
          type="button"
          class="va-turn-rail__dot"
          :class="[
            `va-turn-rail__dot--${item.role === 'assistant' ? 'assistant' : 'user'}`,
            {
              'va-turn-rail__dot--active': item.id === activeId,
              'va-turn-rail__dot--streaming': item.status === 'streaming',
              'va-turn-rail__dot--error': item.status === 'error',
            },
          ]"
          :aria-current="item.id === activeId ? 'true' : undefined"
          :aria-label="`跳到${labelOf(item, index)}`"
          @click="select(item, index)"
          @mouseenter="hoverId = item.id"
          @mouseleave="hoverId = ''"
          @focus="focusId = item.id"
          @blur="focusId = ''"
        >
          <span class="va-turn-rail__pip" aria-hidden="true"></span>
        </button>
      </li>
    </ol>

    <div v-if="previewItem" class="va-turn-rail__preview" role="tooltip" :style="{ top: `${previewTop}px` }">
      <span class="va-turn-rail__preview-index">#{{ previewIndex + 1 }}</span>
      <span class="va-turn-rail__preview-text">{{ labelOf(previewItem, previewIndex) }}</span>
    </div>
  </nav>
</template>

<style src="./VaTurnRail.css"></style>
