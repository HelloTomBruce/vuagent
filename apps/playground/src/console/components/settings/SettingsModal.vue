<script setup lang="ts">
/**
 * 统一「设置」弹窗外壳（TASK-017）
 * - 只负责：遮罩 / 标题 / 左侧设置导航 / 右侧内容区按 tab 分发 / ESC 与点遮罩关闭
 * - 各 tab 面板由父级用具名插槽注入（#models / #interaction），外壳对面板内容零感知，
 *   后续新增设置页只需扩展 types.ts 的 SETTINGS_TABS + 在父级补一个同名插槽
 * - 样式复用既有 .va-console__modal-* 系列，新增导航样式见 console.css .va-settings__nav-*
 */
import { Cpu, MousePointerClick, Settings as SettingsIcon, X } from "lucide-vue-next";
import { onMounted, onUnmounted, type Component } from "vue";
import { SETTINGS_TABS } from "./types";
import type { SettingsTab } from "./types";

withDefaults(
  defineProps<{
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
};

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="va-console__modal-backdrop" @click.self="$emit('close')">
    <div
      class="va-console__modal-box va-settings__box"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      @click.stop
    >
      <!-- 弹窗头部 -->
      <div class="va-console__modal-head">
        <div class="va-console__modal-title-col">
          <div class="va-console__modal-title">
            <SettingsIcon :size="18" class="va-console__modal-title-icon" />
            <span>设置</span>
          </div>
          <p class="va-console__modal-sub">管理模型供应商与交互偏好，后续可持续增加设置页</p>
        </div>
        <button class="va-console__icon-btn" type="button" aria-label="关闭设置" @click="$emit('close')">
          <X :size="18" />
        </button>
      </div>

      <!-- 弹窗主体：左侧设置导航 + 右侧面板分发 -->
      <div class="va-console__modal-body">
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
    </div>
  </div>
</template>
