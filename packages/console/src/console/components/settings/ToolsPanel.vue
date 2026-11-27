<script setup lang="ts">
/**
 * 「工具与场景组件」设置面板（TASK-020）
 * - 单一根滚动区（.va-settings__section）：保证长列表顺畅纵向滚动，杜绝嵌套截断
 * - 支持分类筛选切换：全部 / 内置系统工具 / 业务扩展工具 / 场景组件工具
 * - 覆盖三类工具：内置底层工具、非 UI 业务动作工具、Generative UI 场景组件
 * - 启停配置提交与乐观更新回滚由父级编排，修改即时生效并由服务端持久化
 */
import { ref, computed } from "vue";
import { Wrench, Layers, Briefcase, ShieldAlert } from "lucide-vue-next";
import { toolRiskMetaOf } from "./types";
import type { ToolItem } from "../../api/client";
import { getCardComponent } from "@vuagent/ui";

const props = defineProps<{
  /** 工具清单（父级经 /api/tools 拉取） */
  tools: ToolItem[];
  /** 首次拉取中 */
  loading: boolean;
  /** 拉取失败提示（服务端不可达等） */
  loadError: string;
}>();

const emit = defineEmits<{
  (e: "toggle", tool: ToolItem): void;
}>();

/** 分类过滤：all=全部，builtin=内置系统工具，custom=业务动作工具，scene=场景组件工具 */
const currentFilter = ref<"all" | "builtin" | "custom" | "scene">("all");

/** 内置系统工具列表 */
const builtinTools = computed(() => props.tools.filter((t) => t.source === "builtin" || !t.source));
/** 业务动作工具列表 (非 UI 扩展工具) */
const customTools = computed(() => props.tools.filter((t) => t.source === "custom"));
/** 场景 UI 组件列表 (Generative UI) */
const sceneTools = computed(() => props.tools.filter((t) => t.source === "ui_component"));

/** 判定前端是否已通过 registerCardComponent 注册该场景组件 */
function isFrontendBound(toolName: string): boolean {
  return !!getCardComponent(toolName);
}
</script>

<template>
  <div class="va-settings__panel va-settings__panel--tools">
    <!-- 拉取失败态 -->
    <p v-if="loadError" class="va-settings__tools-error">{{ loadError }}</p>

    <!-- 加载态 -->
    <p v-else-if="loading" class="va-settings__tools-loading">正在加载工具清单…</p>

    <!-- 空态 -->
    <p v-else-if="tools.length === 0" class="va-settings__tools-loading">
      服务端暂无已注册工具
    </p>

    <!-- 唯一的统一滚动区域，确保内容超出时顺畅纵向滚动 -->
    <div v-else class="va-settings__section">
      <!-- 顶部轻量分类筛选，方便快速查看与切换 -->
      <div class="va-settings__tool-filter-tabs">
        <button
          type="button"
          class="va-settings__tool-tab-btn"
          :class="{ 'va-settings__tool-tab-btn--active': currentFilter === 'all' }"
          @click="currentFilter = 'all'"
        >
          全部 ({{ tools.length }})
        </button>
        <button
          type="button"
          class="va-settings__tool-tab-btn"
          :class="{ 'va-settings__tool-tab-btn--active': currentFilter === 'builtin' }"
          @click="currentFilter = 'builtin'"
        >
          <Wrench :size="12" style="vertical-align: -1px; margin-right: 3px" />
          系统基础 ({{ builtinTools.length }})
        </button>
        <button
          v-if="customTools.length > 0"
          type="button"
          class="va-settings__tool-tab-btn"
          :class="{ 'va-settings__tool-tab-btn--active': currentFilter === 'custom' }"
          @click="currentFilter = 'custom'"
        >
          <Briefcase :size="12" style="vertical-align: -1px; margin-right: 3px; color: #0284c7" />
          业务动作 ({{ customTools.length }})
        </button>
        <button
          v-if="sceneTools.length > 0"
          type="button"
          class="va-settings__tool-tab-btn"
          :class="{ 'va-settings__tool-tab-btn--active': currentFilter === 'scene' }"
          @click="currentFilter = 'scene'"
        >
          <Layers :size="12" style="vertical-align: -1px; margin-right: 3px; color: #7e22ce" />
          场景组件 ({{ sceneTools.length }})
        </button>
      </div>

      <!-- 分组 ①：内置系统基础工具 (System Core Tools) -->
      <div v-if="currentFilter === 'all' || currentFilter === 'builtin'" class="va-settings__group-block">
        <div>
          <div class="va-settings__section-title">
            <Wrench :size="14" style="vertical-align: -2px; margin-right: 4px" />
            内置系统基础工具
          </div>
          <p class="va-console__modal-sub" style="margin-top: 2px">
            底层文件读写、沙箱命令执行与文件检索工具。停用后 Agent 本轮起不再调用。
          </p>
        </div>

        <div class="va-settings__toggle-list" style="margin-top: 8px;">
          <div v-for="tool in builtinTools" :key="tool.name" class="va-settings__toggle-row">
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

      <!-- 分组 ②：自定义业务动作工具 (Custom Action Tools) —— 无 UI 契约的函数与动作工具 -->
      <div
        v-if="(currentFilter === 'all' || currentFilter === 'custom') && customTools.length > 0"
        class="va-settings__group-block"
        style="margin-top: 14px;"
      >
        <div>
          <div class="va-settings__section-title">
            <Briefcase :size="14" style="vertical-align: -2px; margin-right: 4px; color: #0284c7" />
            业务扩展工具 (Custom Action Tools)
          </div>
          <p class="va-console__modal-sub" style="margin-top: 2px">
            纯数据、逻辑与动作型业务扩展（数据库查询、Git 探针、CI 触发等）。执行结果直接作为上下文喂回大模型继续思考，高危操作可触发人工审批。
          </p>
        </div>

        <div class="va-settings__toggle-list" style="margin-top: 8px;">
          <div v-for="tool in customTools" :key="tool.name" class="va-settings__toggle-row">
            <div class="va-settings__toggle-text">
              <div class="va-settings__tool-headline">
                <span class="va-settings__toggle-title" style="font-family: var(--va-font-mono, monospace);">{{ tool.name }}</span>
                <span class="va-settings__custom-badge">业务工具</span>
                <span
                  class="va-settings__tool-badge"
                  :class="toolRiskMetaOf(tool.riskLevel).className"
                >
                  {{ toolRiskMetaOf(tool.riskLevel).label }}
                </span>
                <span
                  v-if="tool.requiresApproval"
                  class="va-settings__approval-badge"
                  title="调用此工具前将强制弹出 HITL 人工审批卡"
                >
                  <ShieldAlert :size="10" style="vertical-align: -1px; margin-right: 2px" />
                  人工审批
                </span>
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

      <!-- 分组 ③：场景 UI 组件工具 (Generative UI) -->
      <div
        v-if="(currentFilter === 'all' || currentFilter === 'scene') && sceneTools.length > 0"
        class="va-settings__group-block"
        style="margin-top: 14px;"
      >
        <div>
          <div class="va-settings__section-title">
            <Layers :size="14" style="vertical-align: -2px; margin-right: 4px; color: #7e22ce" />
            场景组件工具 (Generative UI)
          </div>
          <p class="va-console__modal-sub" style="margin-top: 2px">
            由 UIComponentRegistry 开放注册的特定业务场景可视化卡片。模型按需输出参数，前端同名组件动态挂载渲染。
          </p>
        </div>

        <div class="va-settings__toggle-list" style="margin-top: 8px;">
          <div v-for="tool in sceneTools" :key="tool.name" class="va-settings__toggle-row">
            <div class="va-settings__toggle-text">
              <div class="va-settings__tool-headline">
                <span class="va-settings__toggle-title" style="font-family: var(--va-font-mono, monospace);">{{ tool.name }}</span>
                <span class="va-settings__scene-badge">场景组件</span>
                <span
                  v-if="isFrontendBound(tool.name)"
                  class="va-settings__scene-ready"
                  title="前端 CardRegistry 已注册对应渲染器"
                >
                  ✨ 前端已就绪
                </span>
                <span
                  v-else
                  class="va-settings__scene-unbound"
                  title="前端未注册对应组件，将使用优雅降级容器渲染"
                >
                  未绑定组件
                </span>
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
  </div>
</template>
