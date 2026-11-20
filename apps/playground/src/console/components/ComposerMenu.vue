<script setup lang="ts">
/**
 * Composer 三点菜单（TASK-076 F2）：清空输入 / 引用工作区文件 / 导入文本文件 / ⌘K 命令面板
 * - VaDropdown（click 触发、top-end 上弹适配底部座位区）
 * - 「引用工作区文件」只发事件：由 Console 的 @提及浮层承接（悬浮输入框上方，不打断输入——
 *   此前用 VaDialog+Combobox，焦点陷阱+遮罩的上下文切换成本过高，已改浮层）
 * - 导入文本：input[type=file] 客户端读取内联（≤48KB，超出截断标注）——不经服务端、不绕审批链
 */
import { ref } from "vue";
import { MoreHorizontal } from "lucide-vue-next";
import { VaDropdown } from "@vuagent/ui";
import type { DropdownItem } from "@vuagent/ui";

const emit = defineEmits<{
  (e: "clear"): void;
  (e: "refFile"): void;
  (e: "insert", text: string): void;
  (e: "openCommandMenu"): void;
}>();

const items: DropdownItem[] = [
  { id: "clear", label: "清空输入", icon: "✕" },
  { id: "ref-file", label: "引用工作区文件…", icon: "@", shortcut: "@" },
  { id: "import-text", label: "导入文本文件…", icon: "📄" },
  { id: "d1", label: "", divider: true },
  { id: "cmdk", label: "命令面板", icon: "⌘", shortcut: "⌘K" },
];

function onSelect(item: DropdownItem) {
  switch (item.id) {
    case "clear":
      emit("clear");
      break;
    case "ref-file":
      emit("refFile");
      break;
    case "import-text":
      fileInput.value?.click();
      break;
    case "cmdk":
      emit("openCommandMenu");
      break;
  }
}

/* ---------- 导入文本文件（客户端读取，不绕审批链） ---------- */
const fileInput = ref<HTMLInputElement | null>(null);
const IMPORT_CAP = 48 * 1024;

function onImportChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let content = String(reader.result ?? "");
    if (content.length > IMPORT_CAP) {
      content = `${content.slice(0, IMPORT_CAP)}\n…（超出 48KB 已截断）`;
    }
    emit("insert", `\n\n---\n[${file.name}]\n${content}\n---\n`);
  };
  reader.readAsText(file);
}
</script>

<template>
  <VaDropdown :items="items" trigger="click" placement="top-end" :offset="6" @select="onSelect">
    <template #trigger>
      <button class="va-console__seat-btn" type="button" aria-label="输入辅助菜单">
        <MoreHorizontal :size="13" />
      </button>
    </template>
  </VaDropdown>

  <input
    ref="fileInput"
    type="file"
    hidden
    accept=".txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,.ts,.js,.vue,text/*"
    @change="onImportChange"
  />
</template>
