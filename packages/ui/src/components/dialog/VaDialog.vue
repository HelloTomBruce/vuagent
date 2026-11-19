<script lang="ts">
/**
 * 模块级单例（普通 script 块）：堆叠栈与 body 滚动锁在跨实例间共享。
 * 注意不能放 <script setup> 顶层——那是组件实例作用域，每实例各一份会导致
 * 每个弹窗都自认为是栈顶（本文件的 Esc 栈测试曾因此双双关闭）。
 */
const dialogStack: number[] = [];
let dialogSeq = 0;
let scrollLockCount = 0;
let savedBodyStyle: { overflow: string; paddingRight: string } | null = null;

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  if (scrollLockCount === 0) {
    const body = document.body;
    // 滚动条消失会引起布局抖动：按滚动条宽度补偿 padding-right
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const current = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbarWidth}px`;
    }
  }
  scrollLockCount++;
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0 && savedBodyStyle) {
    document.body.style.overflow = savedBodyStyle.overflow;
    document.body.style.paddingRight = savedBodyStyle.paddingRight;
    savedBodyStyle = null;
  }
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useSlots, useTemplateRef, watch } from "vue";
import { X } from "lucide-vue-next";
import type { DialogEvents, DialogProps, DialogSize } from "./types";
import { useFocusTrap } from "./useFocusTrap";

/**
 * VaDialog — 模态弹窗原语（焦点陷阱 + 焦点恢复 + 堆叠栈 + 滚动锁）。
 *
 * 生命周期（不依赖 <Transition>，手动两态驱动，保证 destroyOnClose=false 时
 * 退出动画播完仅隐藏不卸载）：
 *   rendered：弹层是否在 DOM 中（首次打开后置 true；destroyOnClose 时退出动画后归 false）
 *   state："open" | "closed"，CSS 类切换触发 opacity/scale 过渡
 * 打开：rendered → 注册栈/监听/滚动锁 → nextTick 置 open（触发进入过渡）→ 移焦 → opened
 * 关闭：置 closed（触发退出过渡）→ 出栈/摘监听 → 动画结束 → 还原焦点/解锁 → closed → 视 destroyOnClose 卸载
 *
 * 已知取舍：Esc 只认「弹窗栈顶」，与 popover 的浮层栈互不感知——弹窗内开浮层时
 * 按 Esc 会同关两层（v1 接受，跨栈协调留待后续统一 overlay 栈）。
 */

/* 三态布尔 prop（同 VaPopover）：缺省 undefined 保留哨兵语义，缺省值统一走 computed */
const props = withDefaults(defineProps<DialogProps>(), {
  open: undefined,
  closable: undefined,
  maskClosable: undefined,
  closeOnEscape: undefined,
  lockScroll: undefined,
});
const emit = defineEmits<DialogEvents>();
const slots = useSlots();

/* 受控 open 优先，缺省回落非受控 defaultOpen（哨兵） */
const innerOpen = ref(props.defaultOpen ?? false);
const isOpen = computed(() => props.open ?? innerOpen.value);

function setOpen(v: boolean) {
  if (v === isOpen.value) return;
  innerOpen.value = v;
  emit("update:open", v);
}

/** 用户/程序化请求关闭：发 close 事件并置关（受控时父级不同步 open 则保持打开） */
function requestClose() {
  emit("close");
  setOpen(false);
}
function open() {
  setOpen(true);
}

const closable = computed(() => props.closable ?? true);
const maskClosable = computed(() => props.maskClosable ?? true);
const closeOnEscape = computed(() => props.closeOnEscape ?? true);
const lockScroll = computed(() => props.lockScroll ?? true);
const destroyOnClose = computed(() => props.destroyOnClose ?? false);
const size = computed<DialogSize>(() => props.size ?? "md");
const role = computed(() => props.role ?? "dialog");

/* ==========================================================================
   渲染态与进出场动画
   ========================================================================== */
/** 弹层是否在 DOM 中（首开后常驻，除非 destroyOnClose） */
const rendered = ref(isOpen.value);
/** 视觉状态：open 进入 / closed 退出（驱动 CSS 过渡与 aria-hidden） */
const state = ref<"open" | "closed">(isOpen.value ? "open" : "closed");

const id = ++dialogSeq;
const isTop = () => dialogStack[dialogStack.length - 1] === id;
let listening = false;
let holdsLock = false;

/** 组件内过渡时长（与 VaDialog.css 的 var(--va-dur-2) 保持同步，毫秒） */
const TRANSITION_MS = 200;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 代际令牌：快速开关切换时使过期的动画回调失效 */
let lifecycleGen = 0;
function afterTransition(cb: () => void) {
  const g = ++lifecycleGen;
  if (reducedMotion()) {
    cb();
    return;
  }
  setTimeout(() => {
    if (g === lifecycleGen) cb();
  }, TRANSITION_MS);
}

/* ==========================================================================
   焦点陷阱（Tab 循环 + 焦点恢复）
   ========================================================================== */
const panelEl = useTemplateRef<HTMLElement>("panel");

function resolveInitialFocus(): HTMLElement | null | undefined {
  const target = props.initialFocus;
  if (target == null) return undefined; // 缺省：容器内第一个可聚焦元素
  if (typeof target === "string") return panelEl.value?.querySelector<HTMLElement>(target) ?? undefined;
  return target;
}

const trap = useFocusTrap({ container: panelEl, initialFocus: resolveInitialFocus });

/* ==========================================================================
   Esc / Tab / 遮罩：仅栈顶响应
   ========================================================================== */
const onDocKeydown = (e: KeyboardEvent) => {
  if (!isTop()) return;
  if (e.key === "Escape" && closeOnEscape.value) {
    requestClose();
    return;
  }
  if (e.key === "Tab") trap.handleTab(e);
};

function onMaskMousedown(e: MouseEvent) {
  // mousedown + self 判定：从面板内按下拖选文字到遮罩上松开不误关
  if (e.target !== e.currentTarget) return;
  if (!isTop() || !maskClosable.value) return;
  requestClose();
}

function addListeners() {
  if (typeof document === "undefined" || listening) return;
  listening = true;
  document.addEventListener("keydown", onDocKeydown);
  if (!dialogStack.includes(id)) dialogStack.push(id);
  if (lockScroll.value && !holdsLock) {
    lockBodyScroll();
    holdsLock = true;
  }
}

function removeListeners() {
  if (!listening) return;
  listening = false;
  document.removeEventListener("keydown", onDocKeydown);
  const i = dialogStack.indexOf(id);
  if (i >= 0) dialogStack.splice(i, 1);
}

/* ==========================================================================
   ARIA：role=dialog + aria-modal + labelledby/describedby 自动关联
   ========================================================================== */
const uid = useId();
const titleId = `va-dlg-title-${uid}`;
const descId = `va-dlg-desc-${uid}`;

const hasTitle = computed(() => Boolean(props.title) || Boolean(slots.title));
const ariaLabelledby = computed(() => (hasTitle.value ? titleId : undefined));
const ariaDescribedby = computed(() => (props.description ? descId : undefined));
const ariaLabel = computed(() => (hasTitle.value ? undefined : props.ariaLabel));

let a11yWarned = false;
function checkA11yName() {
  if (a11yWarned || typeof console === "undefined") return;
  if (!hasTitle.value && !props.ariaLabel) {
    a11yWarned = true;
    console.warn("[VaDialog] 缺少可访问名称：未提供 title / title 插槽时，请通过 aria-label 传入弹窗名称。");
  }
}

/* ==========================================================================
   开关生命周期
   ========================================================================== */
async function openLifecycle() {
  rendered.value = true;
  checkA11yName();
  addListeners();
  await nextTick(); // 先以 closed 样式落一帧，再置 open 触发进入过渡
  state.value = "open";
  await trap.activate();
  afterTransition(() => emit("opened"));
}

function closeLifecycle() {
  state.value = "closed";
  removeListeners(); // 立即出栈：Esc 与遮罩移交下一层
  afterTransition(() => {
    trap.deactivate();
    if (holdsLock) {
      unlockBodyScroll();
      holdsLock = false;
    }
    if (destroyOnClose.value) rendered.value = false;
    emit("closed");
  });
}

/* flush: "post"：SSR 下不触发；初始打开由 onMounted 补齐（同 VaPopover 模式） */
watch(
  isOpen,
  (v, prev) => {
    if (v === prev) return;
    if (v) void openLifecycle();
    else closeLifecycle();
  },
  { flush: "post" },
);

onMounted(() => {
  if (isOpen.value) void openLifecycle();
});

onBeforeUnmount(() => {
  lifecycleGen++; // 作废在途动画回调
  removeListeners();
  if (holdsLock) {
    unlockBodyScroll();
    holdsLock = false;
  }
  if (isOpen.value) trap.deactivate();
});

defineExpose({ open, close: requestClose });
</script>

<template>
  <Teleport :to="props.teleportTo ?? 'body'">
    <div
      v-if="rendered"
      class="va-dlg__overlay"
      :data-state="state"
      :aria-hidden="state === 'closed' ? 'true' : undefined"
      @mousedown="onMaskMousedown"
    >
      <div
        ref="panel"
        class="va-dlg"
        :class="`va-dlg--${size}`"
        :role="role"
        aria-modal="true"
        :aria-labelledby="ariaLabelledby"
        :aria-describedby="ariaDescribedby"
        :aria-label="ariaLabel"
        tabindex="-1"
      >
        <div v-if="$slots.header || hasTitle || props.description" class="va-dlg__header">
          <slot name="header" :close="requestClose">
            <h2 v-if="hasTitle" :id="titleId" class="va-dlg__title">
              <slot name="title">{{ props.title }}</slot>
            </h2>
            <p v-if="props.description" :id="descId" class="va-dlg__desc">{{ props.description }}</p>
          </slot>
        </div>

        <div class="va-dlg__body">
          <slot :close="requestClose" />
        </div>

        <div v-if="$slots.footer" class="va-dlg__footer">
          <slot name="footer" :close="requestClose" />
        </div>

        <!-- 关闭按钮放 DOM 末尾：初始焦点落在内容区，Tab 循环末端可达 -->
        <button
          v-if="closable"
          type="button"
          class="va-dlg__close"
          aria-label="关闭"
          @click="requestClose"
        >
          <X :size="16" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style src="./VaDialog.css"></style>
