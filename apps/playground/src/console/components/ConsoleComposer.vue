<script setup lang="ts">
/**
 * Console 输入框 + 座位区工具栏
 * 合并原欢迎页/底部两份复制模板为单一 variant 实现（welcome | docked）
 * 内部三个下拉由通用 SeatDropdown 承载，开合自管理
 */
import { computed, ref } from "vue";
import {
  Check,
  ChevronDown,
  Cpu,
  Folder,
  FolderPlus,
  History,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Square,
  Zap,
} from "lucide-vue-next";
import SeatDropdown from "./SeatDropdown.vue";
import type { ModelOption, PermissionMode, WorkspaceItem } from "../types";

const props = defineProps<{
  modelValue: string;
  variant: "welcome" | "docked";
  workspaces: WorkspaceItem[];
  activeWorkspaceId: string;
  availableModels: ModelOption[];
  activeModel: string;
  permissionModes: PermissionMode[];
  activePermission: string;
  workspaceName: string;
  modelName: string;
  isRunning: boolean;
  contextUsed: number;
  contextLimit: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "composer-keydown", event: KeyboardEvent): void;
  (e: "send"): void;
  (e: "stop"): void;
  (e: "select-workspace", id: string): void;
  (e: "pick-workspace"): void;
  (e: "select-model", id: string): void;
  (e: "open-model-settings"): void;
  (e: "select-permission", id: string): void;
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const activePermObj = computed(() => {
  return props.permissionModes.find((p) => p.id === props.activePermission) || props.permissionModes[0];
});

const placeholder = computed(() =>
  props.variant === "welcome"
    ? "给 Agent 一个任务（如：重构认证模块并编写单元测试）…"
    : "继续指令或追问… (Enter 发送，Shift+Enter 换行)"
);

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

defineExpose({
  focus: () => textareaRef.value?.focus(),
});
</script>

<template>
  <div class="va-console__composer-wrapper">
    <textarea
      ref="textareaRef"
      :value="modelValue"
      class="va-console__composer-textarea"
      :placeholder="placeholder"
      :rows="variant === 'welcome' ? 3 : 2"
      @input="onInput"
      @keydown="$emit('composer-keydown', $event)"
    />

    <div class="va-console__composer-toolbar">
      <div class="va-console__toolbar-left">
        <!-- 1. 工作区切换下拉菜单 -->
        <SeatDropdown>
          <template #trigger>
            <Folder :size="13" />
            <span class="va-console__seat-text">{{ workspaceName }}</span>
            <ChevronDown :size="12" />
          </template>

          <div class="va-console__menu-header">切换工作区</div>
          <button
            v-for="w in workspaces"
            :key="w.id"
            class="va-console__menu-item"
            :class="{ 'va-console__menu-item--active': w.id === activeWorkspaceId }"
            type="button"
            @click="$emit('select-workspace', w.id)"
          >
            <Folder :size="13" />
            <span class="va-console__menu-item-name">{{ w.name }}</span>
            <Check v-if="w.id === activeWorkspaceId" :size="13" />
          </button>
          <div class="va-console__menu-divider" />
          <button
            class="va-console__menu-item va-console__menu-item--action"
            type="button"
            @click="$emit('pick-workspace')"
          >
            <FolderPlus :size="14" />
            <span>新建工作区 (系统弹窗)…</span>
          </button>
        </SeatDropdown>

        <!-- 2. 模型切换下拉菜单 -->
        <SeatDropdown>
          <template #trigger>
            <Zap :size="13" />
            <span class="va-console__seat-text">{{ modelName }}</span>
            <ChevronDown :size="12" />
          </template>

          <div class="va-console__menu-header">切换模型引擎</div>
          <button
            v-for="m in availableModels"
            :key="m.id"
            class="va-console__menu-item"
            :class="{ 'va-console__menu-item--active': m.id === activeModel }"
            type="button"
            @click="$emit('select-model', m.id)"
          >
            <Cpu :size="13" />
            <div class="va-console__menu-item-col">
              <span class="va-console__menu-item-name">{{ m.label }}</span>
              <span class="va-console__menu-item-desc">{{ m.meta }}</span>
            </div>
            <Check v-if="m.id === activeModel" :size="13" />
          </button>
          <div class="va-console__menu-divider" />
          <button
            class="va-console__menu-item va-console__menu-item--action"
            type="button"
            @click="$emit('open-model-settings')"
          >
            <Settings :size="13" />
            <span>管理与配置模型…</span>
          </button>
        </SeatDropdown>

        <!-- 3. 权限模式切换 -->
        <SeatDropdown>
          <template #trigger>
            <Shield :size="13" />
            <span class="va-console__seat-text">{{ activePermObj.label }}</span>
            <ChevronDown :size="12" />
          </template>

          <div class="va-console__menu-header">安全沙箱权限模式</div>
          <button
            v-for="p in permissionModes"
            :key="p.id"
            class="va-console__menu-item"
            :class="{ 'va-console__menu-item--active': p.id === activePermission }"
            type="button"
            @click="$emit('select-permission', p.id)"
          >
            <ShieldCheck :size="13" />
            <div class="va-console__menu-item-col">
              <span class="va-console__menu-item-name">{{ p.label }}</span>
              <span class="va-console__menu-item-desc">{{ p.desc }}</span>
            </div>
            <Check v-if="p.id === activePermission" :size="13" />
          </button>
        </SeatDropdown>

        <!-- 4. 上下文长度指示器 -->
        <div class="va-console__seat-badge" title="当前上下文窗口使用量">
          <History :size="12" />
          <span>Context: {{ (contextUsed / 1000).toFixed(1) }}k / {{ (contextLimit / 1000).toFixed(0) }}k</span>
        </div>
      </div>

      <!-- 发送 / 停止按钮 -->
      <div class="va-console__toolbar-right">
        <button
          v-if="variant === 'docked' && isRunning"
          class="va-console__btn-send va-console__btn-send--stop"
          type="button"
          title="停止执行"
          @click="$emit('stop')"
        >
          <Square :size="14" />
          <span>停止</span>
        </button>
        <button
          v-else
          class="va-console__btn-send"
          :disabled="!modelValue.trim() || (variant === 'welcome' && isRunning)"
          type="button"
          @click="$emit('send')"
        >
          <Send :size="14" />
          <span>{{ variant === "welcome" ? "开始执行" : "发送" }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
