<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { VaPopover } from "../popover";
import type { DropdownEvents, DropdownProps, DropdownSlots } from "./types";
import { useDropdown } from "./useDropdown";

/**
 * VaDropdown — 动作菜单（三点菜单型下拉）。
 *
 * 与 command-menu（⌘K 命令面板）/ filter-menu（多组过滤）的区别：
 * 面向「对某一行/某个对象做操作」的菜单，支持快捷键提示、danger 项、checked 项与一层子菜单。
 * 基于 VaPopover：主菜单与子菜单各用一个浮层实例（子菜单以入口项元素为锚点，Teleport 到 body，
 * 因此不会被父浮层的 overflow 裁切）。
 */

const props = withDefaults(defineProps<DropdownProps>(), {
  trigger: "click",
  placement: "bottom-end",
  open: undefined,
  hideChevron: false,
  keepOpenOnSelect: false,
  disabled: false,
});

const emit = defineEmits<DropdownEvents>();
defineSlots<DropdownSlots>();

const triggerEl = useTemplateRef<HTMLButtonElement>("trigger");
const triggerWrap = useTemplateRef<HTMLElement>("triggerWrap");
const menuEl = useTemplateRef<HTMLElement>("menu");
const submenuEl = useTemplateRef<HTMLElement>("submenu");

const {
  menuId,
  submenuId,
  isOpen,
  activeId,
  openSubId,
  subActiveId,
  submenuAnchor,
  submenuOpen,
  submenuLabel,
  popoverAnchor,
  entries,
  subEntries,
  itemDomId,
  subItemDomId,
  setActive,
  setSubActive,
  openMenu,
  closeMenu,
  toggleMenu,
  setOpen,
  onTriggerClick,
  onTriggerKeydown,
  onTriggerKeyup,
  onTriggerContextmenu,
  onMenuKeydown,
  onSubKeydown,
  onItemClick,
  onSubItemClick,
} = useDropdown(
  props,
  { trigger: triggerEl, triggerWrap, menu: menuEl, submenu: submenuEl },
  {
    "update:open": (v) => emit("update:open", v),
    open: () => emit("open"),
    close: () => emit("close"),
    select: (item) => emit("select", item),
  },
);

/* 触发器显隐：显式 triggerIcon 优先；仅给 triggerLabel 时渲染文字按钮 */
const showIcon = computed(() => {
  if (props.triggerIcon !== undefined) return props.triggerIcon !== "";
  return !props.triggerLabel;
});
const showLabel = computed(() => !!props.triggerLabel && !showIcon.value);
const iconGlyph = computed(() => props.triggerIcon ?? "⋮");
const triggerAriaLabel = computed(() => props.ariaLabel ?? props.triggerLabel ?? "更多操作");

defineExpose({ open: openMenu, close: closeMenu, toggle: toggleMenu, setOpen });
</script>

<template>
  <VaPopover
    :open="isOpen"
    :anchor="popoverAnchor"
    :placement="props.placement"
    :disabled="props.disabled"
    :close-on-outside-click="false"
    :close-on-escape="false"
    @update:open="setOpen"
  >
    <template #trigger>
      <!-- 包装层统一承接点击/键盘/右键：click 模式放行给 VaPopover 的 trigger 包装元素切换，
           contextmenu / manual 模式在此拦截，避免左键误开 -->
      <span
        ref="triggerWrap"
        class="va-dd"
        @click="onTriggerClick"
        @keydown="onTriggerKeydown"
        @keyup="onTriggerKeyup"
        @contextmenu="onTriggerContextmenu"
      >
        <slot name="trigger" :open="isOpen" :toggle="toggleMenu">
          <button
            ref="trigger"
            type="button"
            class="va-dd__trigger"
            aria-haspopup="menu"
            :aria-expanded="isOpen"
            :aria-controls="isOpen ? menuId : undefined"
            :aria-label="showLabel ? undefined : triggerAriaLabel"
            :disabled="props.disabled"
          >
            <span v-if="showIcon" class="va-dd__icon" aria-hidden="true">{{ iconGlyph }}</span>
            <span v-if="showLabel" class="va-dd__label">{{ props.triggerLabel }}</span>
            <span v-if="!props.hideChevron" class="va-dd__chev" aria-hidden="true">▾</span>
          </button>
        </slot>
      </span>
    </template>

    <div
      :id="menuId"
      ref="menu"
      class="va-dd__menu"
      role="menu"
      :aria-label="props.ariaLabel ?? '动作菜单'"
      @keydown="onMenuKeydown"
      @mousedown.prevent
    >
      <template v-for="entry in entries" :key="entry.key">
        <div v-if="entry.type === 'group'" class="va-dd__group" role="presentation">
          {{ entry.label }}
        </div>
        <div v-else-if="entry.type === 'divider'" class="va-dd__divider" role="separator" />
        <button
          v-else-if="entry.type === 'item'"
          :id="itemDomId(entry.item.id)"
          type="button"
          class="va-dd__item"
          role="menuitem"
          tabindex="-1"
          :aria-haspopup="entry.item.children?.length ? 'menu' : undefined"
          :aria-expanded="entry.item.children?.length ? openSubId === entry.item.id : undefined"
          :aria-disabled="entry.item.disabled || undefined"
          :data-active="activeId === entry.item.id || undefined"
          :data-checked="entry.item.checked || undefined"
          :data-danger="entry.item.danger || undefined"
          :disabled="entry.item.disabled"
          @click="onItemClick(entry.item)"
          @keyup.space.prevent
          @mouseenter="setActive(entry.item.id)"
          @focus="setActive(entry.item.id)"
        >
          <slot
            name="item"
            :item="entry.item"
            :active="activeId === entry.item.id"
            :checked="!!entry.item.checked"
            :disabled="!!entry.item.disabled"
          >
            <span class="va-dd__check" aria-hidden="true">{{ entry.item.checked ? "✓" : "" }}</span>
            <span v-if="entry.item.icon" class="va-dd__item-icon" aria-hidden="true">{{ entry.item.icon }}</span>
            <span class="va-dd__item-label">{{ entry.item.label }}</span>
            <span v-if="entry.item.shortcut" class="va-dd__shortcut">{{ entry.item.shortcut }}</span>
            <span v-if="entry.item.children?.length" class="va-dd__sub-arrow" aria-hidden="true">›</span>
          </slot>
        </button>
      </template>
    </div>

    <!-- 一层子菜单：独立浮层，锚点是当前入口项，不受主菜单 overflow 裁切 -->
    <VaPopover
      :open="submenuOpen"
      :anchor="submenuAnchor"
      placement="right"
      :offset="2"
      :close-on-outside-click="false"
      :close-on-escape="false"
    >
      <div
        :id="submenuId"
        ref="submenu"
        class="va-dd__menu va-dd__submenu"
        role="menu"
        :aria-label="submenuLabel"
        @keydown="onSubKeydown"
        @mousedown.prevent
      >
        <template v-for="entry in subEntries" :key="entry.key">
          <div v-if="entry.type === 'group'" class="va-dd__group" role="presentation">
            {{ entry.label }}
          </div>
          <div v-else-if="entry.type === 'divider'" class="va-dd__divider" role="separator" />
          <button
            v-else-if="entry.type === 'item'"
            :id="subItemDomId(openSubId!, entry.item.id)"
            type="button"
            class="va-dd__item"
            role="menuitem"
            tabindex="-1"
            :aria-disabled="entry.item.disabled || undefined"
            :data-active="subActiveId === entry.item.id || undefined"
            :data-checked="entry.item.checked || undefined"
            :data-danger="entry.item.danger || undefined"
            :disabled="entry.item.disabled"
            @click="onSubItemClick(entry.item)"
            @keyup.space.prevent
            @mouseenter="setSubActive(entry.item.id)"
            @focus="setSubActive(entry.item.id)"
          >
            <slot
              name="item"
              :item="entry.item"
              :active="subActiveId === entry.item.id"
              :checked="!!entry.item.checked"
              :disabled="!!entry.item.disabled"
            >
              <span class="va-dd__check" aria-hidden="true">{{ entry.item.checked ? "✓" : "" }}</span>
              <span v-if="entry.item.icon" class="va-dd__item-icon" aria-hidden="true">{{ entry.item.icon }}</span>
              <span class="va-dd__item-label">{{ entry.item.label }}</span>
              <span v-if="entry.item.shortcut" class="va-dd__shortcut">{{ entry.item.shortcut }}</span>
            </slot>
          </button>
        </template>
      </div>
    </VaPopover>
  </VaPopover>
</template>

<style src="./VaDropdown.css"></style>
