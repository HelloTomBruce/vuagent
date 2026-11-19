<script setup lang="ts">
/**
 * 「工具」设置面板（TASK-020）
 * - 纯展示组件：行式布局复用 InteractionPanel 模式（标题 + 摘要 + 徽标 + switch），
 *   行内容来自服务端 /api/tools 返回的 registry 元数据（而非本地描述表）
 * - 展示元数据（风险徽标文案/样式、「写」标记）由 types.ts 描述表提供，便于 node 环境单测
 * - 启停提交与乐观更新回滚由父级（Console.vue）编排，本组件只上报 toggle 意图
 */
import { Wrench } from "lucide-vue-next";
import { toolRiskMetaOf } from "./types";
import type { ToolItem } from "../../api/client";

defineProps<{
  /** 内置工具清单（父级经 /api/tools 拉取） */
  tools: ToolItem[];
  /** 首次拉取中 */
  loading: boolean;
  /** 拉取失败提示（服务端不可达等） */
  loadError: string;
}>();

const emit = defineEmits<{
  (e: "toggle", tool: ToolItem): void;
}>();
</script>

<template>
  <div class="va-settings__panel va-settings__panel--tools">
    <div class="va-settings__section">
      <div>
        <div class="va-settings__section-title">
          <Wrench :size="14" style="vertical-align: -2px; margin-right: 4px" />
          内置工具
        </div>
        <p class="va-console__modal-sub" style="margin-top: 2px">
          停用后 Agent 本轮起不再调用该工具，修改即时生效并由服务端持久化
        </p>
      </div>

      <!-- 拉取失败态 -->
      <p v-if="loadError" class="va-settings__tools-error">{{ loadError }}</p>

      <!-- 加载态 -->
      <p v-else-if="loading" class="va-settings__tools-loading">正在加载工具清单…</p>

      <!-- 空态 -->
      <p v-else-if="tools.length === 0" class="va-settings__tools-loading">
        服务端暂无已注册工具
      </p>

      <!-- 行式启停列表（服务端清单驱动；徽标元数据本地描述表） -->
      <div v-else class="va-settings__toggle-list">
        <div v-for="tool in tools" :key="tool.name" class="va-settings__toggle-row">
          <div class="va-settings__toggle-text">
            <div class="va-settings__tool-headline">
              <span class="va-settings__toggle-title">{{ tool.name }}</span>
              <span
                class="va-settings__tool-badge"
                :class="toolRiskMetaOf(tool.riskLevel).className"
              >
                {{ toolRiskMetaOf(tool.riskLevel).label }}
              </span>
              <span v-if="tool.writesWorkspace" class="va-settings__tool-write">写</span>
            </div>
            <span class="va-settings__toggle-desc" :title="tool.description">{{ tool.description }}</span>
          </div>
          <button
            class="va-settings__switch"
            :class="{ 'va-settings__switch--on': tool.enabled }"
            type="button"
            role="switch"
            :aria-checked="tool.enabled"
            :aria-label="`启用 ${tool.name}`"
            @click="emit('toggle', tool)"
          >
            <span class="va-settings__switch-knob" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
