<script setup lang="ts">
/**
 * 统一「设置」弹窗外壳（TASK-017；TASK-039 迁移到 VaDialog）
 * - 外壳职责收敛为：VaDialog（焦点陷阱/焦点还原/滚动锁/Esc/遮罩关闭）
 *   + 左侧设置导航 + 右侧内容区按 tab 分发
 * - open 由父级受控（isModelSettingsOpen → props.open）；关闭请求经 emit("close") 回流父级
 * - 各 tab 面板由父级用具名插槽注入（#models / #interaction…），外壳对面板内容零感知，
 *   后续新增设置页只需扩展 types.ts 的 SETTINGS_TABS + 在父级补一个同名插槽
 * - 布局适配（宽面板 + 双栏接管 va-dlg__body）见 console.css 的 .va-settings__dlg-body / :has 规则
 */
import { Cpu, Gauge, MessageSquareText, MousePointerClick, Settings as SettingsIcon, ShieldCheck, Wrench } from "lucide-vue-next";
import { type Component } from "vue";
import { VaDialog } from "@vuagent/ui";
import { SETTINGS_TABS } from "./types";
import type { SettingsTab } from "./types";

const props = withDefaults(
  defineProps<{
    /** 受控开关（父级 isModelSettingsOpen） */
    open: boolean;
    /** 当前激活的设置 tab，配合 v-model:active-tab；默认打开「模型与 API」 */
    activeTab?: SettingsTab;
  }>(),
  { activeTab: "models" }
);

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:activeTab", tab: SettingsTab): void;
}>();

/** nav 图标按 id 附着：描述表本身保持纯数据，便于 node 环境单测 */
const TAB_ICONS: Record<SettingsTab, Component> = {
  models: Cpu,
  interaction: MousePointerClick,
  tools: Wrench,
  execution: Gauge,
  security: ShieldCheck,
  prompt: MessageSquareText,
};

/** VaDialog 的关闭请求（Esc / 遮罩 / 右上角 X）统一回流父级 */
function onRequestClose(v: boolean) {
  if (!v) emit("close");
}
</script>

<template>
  <VaDialog
    :open="props.open"
    size="lg"
    aria-label="设置"
    description="管理模型供应商与交互偏好，后续可持续增加设置页"
    @update:open="onRequestClose"
  >
    <template #title>
      <span class="va-settings__title">
        <SettingsIcon :size="16" aria-hidden="true" />
        设置
      </span>
    </template>

    <!-- 弹窗主体：左侧设置导航 + 右侧面板分发（min-height:0 滚动链见 console.css） -->
    <div class="va-settings__dlg-body">
      <nav class="va-settings__nav" aria-label="设置导航">
        <button
          v-for="tab in SETTINGS_TABS"
          :key="tab.id"
          class="va-settings__nav-item"
          :class="{ 'va-settings__nav-item--active': tab.id === activeTab }"
          type="button"
          :aria-current="tab.id === activeTab ? 'true' : undefined"
          @click="$emit('update:activeTab', tab.id)"
        >
          <component :is="TAB_ICONS[tab.id]" :size="15" class="va-settings__nav-icon" />
          <span class="va-settings__nav-text">
            <span class="va-settings__nav-title">{{ tab.title }}</span>
            <span class="va-settings__nav-desc">{{ tab.description }}</span>
          </span>
        </button>
      </nav>

      <div class="va-settings__panel-area">
        <slot :name="activeTab" />
      </div>
    </div>
  </VaDialog>
</template>
