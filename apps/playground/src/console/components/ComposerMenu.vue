<script setup lang="ts">
/**
 * Composer 三点菜单（TASK-076 F2）：清空输入 / 引用工作区文件 / 导入文本文件 / ⌘K 命令面板
 * - VaDropdown（click 触发、top-end 上弹适配底部座位区）
 * - 引用文件：VaDialog + VaCombobox（工作区文件树懒加载扁平化；引用以 [@引用] 路径块插入输入）
 * - 导入文本：input[type=file] 客户端读取内联（≤48KB，超出截断标注）——不经服务端、不绕审批链
 */
import { ref } from "vue";
import { MoreHorizontal } from "lucide-vue-next";
import { VaCombobox, VaDialog, VaDropdown } from "@vuagent/ui";
import type { DropdownItem } from "@vuagent/ui";
import { fetchWorkspaceFiles } from "../api/client";

const props = defineProps<{
  /** 当前工作区 id（引用文件数据源；空则菜单项禁用） */
  workspaceId: string;
}>();

/** 服务端文件树节点（与 /api/workspaces/:id/files 响应对齐的最小形状） */
interface RefFileNode {
  path: string;
  type?: string;
  children?: RefFileNode[];
}

const emit = defineEmits<{
  (e: "clear"): void;
  (e: "insert", text: string): void;
  (e: "openCommandMenu"): void;
}>();

const items: DropdownItem[] = [
  { id: "clear", label: "清空输入", icon: "✕" },
  { id: "ref-file", label: "引用工作区文件…", icon: "@" },
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
      void openRefDialog();
      break;
    case "import-text":
      fileInput.value?.click();
      break;
    case "cmdk":
      emit("openCommandMenu");
      break;
  }
}

/* ---------- 引用工作区文件 ---------- */
const refDialogOpen = ref(false);
const fileOptions = ref<Array<{ value: string; label: string }>>([]);
const filesLoading = ref(false);
const pickedFile = ref("");

/** 懒加载：打开弹窗时拉文件树并扁平化为路径选项 */
async function openRefDialog() {
  refDialogOpen.value = true;
  fileOptions.value = [];
  if (!props.workspaceId) return;
  filesLoading.value = true;
  try {
    const data = await fetchWorkspaceFiles(props.workspaceId);
    const out: Array<{ value: string; label: string }> = [];
    const walk = (nodes: RefFileNode[]): void => {
      for (const n of nodes ?? []) {
        if (n.type === "dir" && n.children?.length) walk(n.children);
        else out.push({ value: n.path, label: n.path });
      }
    };
    walk((data?.tree ?? []) as RefFileNode[]);
    fileOptions.value = out.slice(0, 500);
  } finally {
    filesLoading.value = false;
  }
}

function onFileSelect(option: { value: string; label: string }) {
  emit("insert", `\n\n[@引用文件] ${option.value}\n`);
  pickedFile.value = "";
  refDialogOpen.value = false;
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
      <button class="va-console__seat-btn" type="button" aria-label="输入辅助菜单" :disabled="false">
        <MoreHorizontal :size="13" />
      </button>
    </template>
  </VaDropdown>

  <!-- 引用工作区文件 -->
  <VaDialog
    :open="refDialogOpen"
    size="sm"
    aria-label="引用工作区文件"
    description="选择当前工作区中的文件，以 [@引用文件] 块插入输入框"
    @update:open="refDialogOpen = $event"
  >
    <template #title>引用工作区文件</template>
    <div style="display: flex; flex-direction: column; gap: 10px">
      <VaCombobox
        v-model:model-value="pickedFile"
        :options="fileOptions"
        label="搜索工作区文件路径"
        placeholder="输入路径关键词过滤…"
        :empty-label="filesLoading ? '加载中…' : '无匹配文件'"
        @select="onFileSelect"
      />
      <p v-if="!workspaceId" style="margin: 0; font-size: 12px; color: var(--va-text-muted, #6b7280)">
        先选择工作区后再引用文件
      </p>
    </div>
  </VaDialog>

  <input ref="fileInput" type="file" hidden accept=".txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,.ts,.js,.vue,text/*" @change="onImportChange" />
</template>
