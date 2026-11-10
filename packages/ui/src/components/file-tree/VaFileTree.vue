<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { FileNode, FileTreeEvents, FileTreeProps } from "./types";
import { FILE_STATUS_LABEL } from "./types";
import { countStatus } from "./tree";
import { useFileTree } from "./useFileTree";

const props = defineProps<FileTreeProps>();

const emit = defineEmits<FileTreeEvents>();

const STATUS_TITLE: Record<string, string> = {
  modified: "已修改",
  added: "新增",
  deleted: "删除",
  untracked: "未跟踪",
};

const { toggleDir, currentSelected, select, rows, moveFocus, isActive } = useFileTree(props);

const rootEl = ref<HTMLElement | null>(null);

function activate(row: { node: FileNode; isDir: boolean; expanded: boolean }) {
  if (row.isDir) {
    const value = toggleDir(row.node.path);
    emit("toggle", row.node, value);
    return;
  }
  emit("update:selected", select(row.node.path));
  emit("select", row.node);
}

/** 把焦点移回"当前项"（键盘操作后） */
function refocus() {
  nextTick(() => rootEl.value?.querySelector<HTMLElement>("[data-active='true']")?.focus());
}

/** 行级键盘：↑↓ 移动，← 折叠/回父级，→ 展开，Enter/Space 激活 */
function onKeydown(e: KeyboardEvent, row: { node: FileNode; isDir: boolean; expanded: boolean }) {
  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      moveFocus(-1);
      refocus();
      break;
    case "ArrowDown":
      e.preventDefault();
      moveFocus(1);
      refocus();
      break;
    case "ArrowRight":
      if (row.isDir && !row.expanded) {
        e.preventDefault();
        emit("toggle", row.node, toggleDir(row.node.path, true));
      }
      break;
    case "ArrowLeft":
      if (row.isDir && row.expanded) {
        e.preventDefault();
        emit("toggle", row.node, toggleDir(row.node.path, false));
      } else {
        const parent = row.node.path.split("/").slice(0, -1).join("/");
        if (parent) {
          e.preventDefault();
          moveFocusTo(parent);
        }
      }
      break;
    case "Enter":
    case " ":
      e.preventDefault();
      activate(row);
      break;
  }
}

function moveFocusTo(path: string) {
  // useFileTree 只暴露相对移动：按可见行重定位（父目录一定在上方，找到即可）
  const idx = rows.value.findIndex((r) => r.node.path === path);
  if (idx >= 0) {
    const cur = rows.value.findIndex((r) => isActive(r.node.path));
    if (cur >= 0) moveFocus(idx - cur);
    refocus();
  }
}
</script>

<template>
  <div class="va-ftree">
    <header v-if="props.title" class="va-ftree__head">{{ props.title }}</header>
    <div
      ref="rootEl"
      class="va-ftree__body"
      role="tree"
      :aria-label="props.title || '文件树'"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
    >
      <div
        v-for="row in rows"
        :key="row.node.path"
        role="treeitem"
        :aria-level="row.level"
        :aria-expanded="row.isDir ? row.expanded : undefined"
        :aria-selected="row.isDir ? undefined : currentSelected === row.node.path"
        :data-active="isActive(row.node.path)"
        :tabindex="isActive(row.node.path) ? 0 : -1"
        class="va-ftree__row"
        :class="{
          'va-ftree__row--dir': row.isDir,
          'va-ftree__row--selected': !row.isDir && currentSelected === row.node.path,
        }"
        :style="{ paddingLeft: `${(row.level - 1) * 16 + 8}px` }"
        @click="activate(row)"
        @keydown="onKeydown($event, row)"
      >
        <span v-if="row.isDir" class="va-ftree__caret" aria-hidden="true">{{ row.expanded ? "▾" : "▸" }}</span>
        <span v-else class="va-ftree__dot" aria-hidden="true" />
        <span class="va-ftree__name">{{ row.node.path.split("/").pop() }}</span>
        <span class="va-ftree__spacer" />
        <span v-if="row.isDir && countStatus(row.node)" class="va-ftree__count" aria-label="含变更文件">{{ countStatus(row.node) }}</span>
        <span
          v-if="row.node.status"
          class="va-ftree__status"
          :data-status="row.node.status"
          :title="`${FILE_STATUS_LABEL[row.node.status]} · ${STATUS_TITLE[row.node.status]}`"
        >{{ FILE_STATUS_LABEL[row.node.status] }}</span>
      </div>
      <p v-if="!rows.length" class="va-ftree__empty">没有文件。</p>
    </div>
  </div>
</template>

<style src="./VaFileTree.css"></style>
