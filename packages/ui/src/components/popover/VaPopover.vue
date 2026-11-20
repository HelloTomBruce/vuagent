<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import type { PopoverEvents, PopoverPlacement, PopoverProps } from "./types";
import { DEFAULT_OFFSET, useFloating } from "./useFloating";

/**
 * VaPopover — 浮层原语（Select / Dropdown / Tooltip 共用基座）。
 * 薄模板：trigger 插槽（内部包装元素充当锚点并绑定点击切换）
 * + Teleport 到 body 的定位容器 + 默认插槽内容。
 * 定位/关闭交互全部委托 useFloating；容器无 role，由消费组件声明语义。
 */

/* 三态布尔 prop：Vue 会把缺省 boolean 转成 false，无法区分「未传」与「显式 false」，
   故 open / closeOnOutsideClick / closeOnEscape 显式声明 default: undefined 保留哨兵语义 */
const props = withDefaults(defineProps<PopoverProps>(), {
  open: undefined,
  closeOnOutsideClick: undefined,
  closeOnEscape: undefined,
});
const emit = defineEmits<PopoverEvents>();

/* 受控 open 优先，缺省回落非受控 defaultOpen（哨兵） */
const innerOpen = ref(props.defaultOpen ?? false);
const isOpen = computed(() => props.open ?? innerOpen.value);

function setOpen(v: boolean) {
  if (v === isOpen.value) return;
  innerOpen.value = v;
  emit("update:open", v);
  if (v) emit("open");
  else emit("close");
}
function open() {
  if (props.disabled) return;
  setOpen(true);
}
function close() {
  setOpen(false);
}
function toggle() {
  if (isOpen.value) close();
  else open();
}

/* 禁用即收：打开中被置 disabled 时立即关闭 */
watch(
  () => props.disabled,
  (d) => {
    if (d) close();
  },
);

/* 其余 props 缺省值统一走 computed（布尔缺省 false 的与 Vue 转换结果一致，无需哨兵） */
const placement = computed<PopoverPlacement>(() => props.placement ?? "bottom-start");
const offset = computed(() => props.offset ?? DEFAULT_OFFSET);
const matchAnchorWidth = computed(() => props.matchAnchorWidth ?? false);
const closeOnOutsideClick = computed(() => props.closeOnOutsideClick ?? true);
const closeOnEscape = computed(() => props.closeOnEscape ?? true);

const triggerEl = useTemplateRef<HTMLElement>("trigger");
const floatingEl = useTemplateRef<HTMLElement>("floating");

/** 锚点解析：外部 anchor 优先，缺省用 trigger 包装元素 */
const resolvedAnchor = computed(() => props.anchor ?? triggerEl.value ?? null);

const { floatingStyle, actualPlacement, update } = useFloating({
  anchor: resolvedAnchor,
  floating: floatingEl,
  open: isOpen,
  placement,
  offset,
  matchAnchorWidth,
  closeOnOutsideClick,
  closeOnEscape,
  onRequestClose: close,
});

defineExpose({ open, close, toggle, update });
</script>

<template>
  <span
    v-if="$slots.trigger"
    ref="trigger"
    class="va-pop__trigger"
    :data-open="isOpen"
    :data-disabled="props.disabled || undefined"
    @click="toggle"
  >
    <slot name="trigger" :open="isOpen" :toggle="toggle" />
  </span>

  <Teleport :to="props.teleportTo ?? 'body'">
    <Transition name="va-pop">
      <div
        v-if="isOpen"
        ref="floating"
        class="va-pop"
        :style="floatingStyle"
        :data-placement="actualPlacement"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </Teleport>
</template>

<style src="./VaPopover.css"></style>
