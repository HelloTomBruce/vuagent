<script setup lang="ts">
/**
 * 「交互」设置面板（TASK-017）
 * - 渲染逻辑表驱动：INTERACTION_SETTING_ITEMS 描述表 → 行式 toggle（标题 + 一句话说明 + switch）
 * - 数据层为 useInteractionSettings 模块级单例（与 AssistantTurn / CardRenderer 消费同一份），
 *   变更经 watch 自动持久化 localStorage，刷新页面后保持
 */
import { useInteractionSettings } from "../../composables/useInteractionSettings";
import type { InteractionSettings } from "../../composables/useInteractionSettings";
import { INTERACTION_SETTING_ITEMS } from "./types";

const { settings, updateSetting } = useInteractionSettings();

function onToggle(key: keyof InteractionSettings) {
  updateSetting(key, !settings.value[key]);
}
</script>

<template>
  <div class="va-settings__panel va-settings__panel--interaction">
    <div class="va-settings__section">
      <div>
        <div class="va-settings__section-title">会话交互</div>
        <p class="va-console__modal-sub" style="margin-top: 2px">
          调整对话界面的自动折叠行为，修改即时生效并本地记忆
        </p>
      </div>

      <div class="va-settings__toggle-list">
        <div v-for="item in INTERACTION_SETTING_ITEMS" :key="item.key" class="va-settings__toggle-row">
          <div class="va-settings__toggle-text">
            <span class="va-settings__toggle-title">{{ item.title }}</span>
            <span class="va-settings__toggle-desc">{{ item.description }}</span>
          </div>
          <button
            class="va-settings__switch"
            :class="{ 'va-settings__switch--on': settings[item.key] }"
            type="button"
            role="switch"
            :aria-checked="settings[item.key]"
            :aria-label="item.title"
            @click="onToggle(item.key)"
          >
            <span class="va-settings__switch-knob" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
