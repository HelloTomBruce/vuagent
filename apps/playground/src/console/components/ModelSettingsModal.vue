<script setup lang="ts">
/**
 * 模型与推理引擎配置弹窗（整体从 Console.vue 迁出）
 * modelForm 由父级 composable 持有，表单直接原地编辑其嵌套字段
 */
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Key,
  Loader2,
  Plus,
  Sliders,
  Trash2,
  X,
  Zap,
} from "lucide-vue-next";
import type { ModelProfileItem } from "../types";

defineProps<{
  modelProfiles: ModelProfileItem[];
  selectedProfileId: string;
  isCreatingNewModel: boolean;
  showApiKey: boolean;
  isTestingConnection: boolean;
  testStatus: { ok: boolean; message: string } | null;
  modelForm: ModelProfileItem;
}>();

defineEmits<{
  (e: "close"): void;
  (e: "create-new"): void;
  (e: "select-profile", profile: ModelProfileItem): void;
  (e: "provider-change", provider: string): void;
  (e: "save"): void;
  (e: "delete-profile"): void;
  (e: "test"): void;
  (e: "update:showApiKey", value: boolean): void;
}>();
</script>

<template>
  <div class="va-console__modal-backdrop" @click.self="$emit('close')">
    <div class="va-console__modal-box" role="dialog" aria-modal="true" @click.stop>
      <!-- 弹窗头部 -->
      <div class="va-console__modal-head">
        <div class="va-console__modal-title-col">
          <div class="va-console__modal-title">
            <Cpu :size="18" class="va-console__modal-title-icon" />
            <span>模型与推理引擎配置 (Model Settings)</span>
          </div>
          <p class="va-console__modal-sub">
            配置接入 DeepSeek、阿里云通义千问、Claude、OpenAI、本地 Ollama 或任意兼容接口
          </p>
        </div>
        <button class="va-console__icon-btn" type="button" @click="$emit('close')">
          <X :size="18" />
        </button>
      </div>

      <!-- 弹窗主体：左侧配置列表 + 右侧表单 -->
      <div class="va-console__modal-body">
        <!-- 左侧：模型列表 -->
        <div class="va-console__modal-left">
          <div class="va-console__modal-list-head">
            <span>已配置模型 ({{ modelProfiles.length }})</span>
            <button class="va-console__btn-add-profile" type="button" @click="$emit('create-new')">
              <Plus :size="13" /> 添加
            </button>
          </div>

          <div class="va-console__modal-profile-list">
            <div
              v-for="p in modelProfiles"
              :key="p.id"
              class="va-console__profile-card"
              :class="{ 'va-console__profile-card--active': p.id === selectedProfileId && !isCreatingNewModel }"
              @click="$emit('select-profile', p)"
            >
              <div class="va-console__profile-card-top">
                <span class="va-console__profile-name">{{ p.name }}</span>
                <span v-if="p.isDefault" class="va-console__default-chip">默认</span>
              </div>
              <div class="va-console__profile-card-sub">
                <span class="va-console__provider-pill">{{ p.provider }}</span>
                <span class="va-console__model-id">{{ p.model }}</span>
              </div>
            </div>

            <!-- 新建中状态卡片 -->
            <div
              v-if="isCreatingNewModel"
              class="va-console__profile-card va-console__profile-card--active"
            >
              <div class="va-console__profile-card-top">
                <span class="va-console__profile-name">{{ modelForm.name || "新模型配置" }}</span>
                <span class="va-console__new-chip">新建中</span>
              </div>
              <div class="va-console__profile-card-sub">
                <span class="va-console__provider-pill">{{ modelForm.provider }}</span>
                <span class="va-console__model-id">{{ modelForm.model }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：详细参数编辑表单 -->
        <div class="va-console__modal-right">
          <div class="va-console__form-group">
            <label class="va-console__label">显示名称 (Profile Name)</label>
            <input
              v-model="modelForm.name"
              class="va-console__input"
              type="text"
              placeholder="如 DeepSeek V3 (生产)"
            />
          </div>

          <div class="va-console__form-row">
            <div class="va-console__form-group flex-1">
              <label class="va-console__label">供应商 (Provider)</label>
              <select
                class="va-console__select"
                :value="modelForm.provider"
                @change="$emit('provider-change', ($event.target as HTMLSelectElement).value)"
              >
                <option value="deepseek">DeepSeek (官方 API)</option>
                <option value="qwen">Qwen / 阿里云通义千问</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT-4o/o3)</option>
                <option value="ollama">Ollama (本地运行)</option>
                <option value="custom">Custom (OpenAI 兼容接口)</option>
              </select>
            </div>

            <div class="va-console__form-group flex-1">
              <label class="va-console__label">模型标识 (Model ID)</label>
              <input
                v-model="modelForm.model"
                class="va-console__input"
                type="text"
                placeholder="如 deepseek-chat"
              />
            </div>
          </div>

          <div class="va-console__form-group">
            <label class="va-console__label">
              <Globe :size="12" /> API 基础地址 (Base URL)
            </label>
            <input
              v-model="modelForm.baseUrl"
              class="va-console__input font-mono"
              type="text"
              placeholder="如 https://api.deepseek.com/v1"
            />
          </div>

          <div class="va-console__form-group">
            <label class="va-console__label">
              <Key :size="12" /> API 密钥 (API Key)
            </label>
            <div class="va-console__input-with-action">
              <input
                v-model="modelForm.apiKey"
                class="va-console__input font-mono"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="sk-..."
              />
              <button
                class="va-console__input-addon-btn"
                type="button"
                @click="$emit('update:showApiKey', !showApiKey)"
              >
                <EyeOff v-if="showApiKey" :size="14" />
                <Eye v-else :size="14" />
              </button>
            </div>
          </div>

          <div class="va-console__form-row">
            <div class="va-console__form-group flex-1">
              <label class="va-console__label">上下文窗口 (Context Window)</label>
              <input
                v-model.number="modelForm.contextWindow"
                class="va-console__input font-mono"
                type="number"
                step="1000"
                placeholder="128000"
              />
            </div>

            <div class="va-console__form-group flex-1">
              <label class="va-console__label">
                <Sliders :size="12" /> 温度采样 (Temperature: {{ modelForm.temperature }})
              </label>
              <input
                v-model.number="modelForm.temperature"
                class="va-console__range"
                type="range"
                min="0"
                max="1"
                step="0.05"
              />
            </div>
          </div>

          <div class="va-console__checkbox-row">
            <label class="va-console__checkbox-label">
              <input v-model="modelForm.isDefault" type="checkbox" />
              <span>设为全局默认模型</span>
            </label>
          </div>

          <!-- 连通性测试状态展示 -->
          <div
            v-if="testStatus"
            class="va-console__test-status-box"
            :class="{
              'va-console__test-status-box--ok': testStatus.ok,
              'va-console__test-status-box--err': !testStatus.ok,
            }"
          >
            <CheckCircle2 v-if="testStatus.ok" :size="14" />
            <AlertCircle v-else :size="14" />
            <span>{{ testStatus.message }}</span>
          </div>
        </div>
      </div>

      <!-- 弹窗底栏 -->
      <div class="va-console__modal-foot">
        <div class="va-console__foot-left">
          <button
            v-if="!isCreatingNewModel && modelProfiles.length > 1"
            class="va-console__btn-delete-profile"
            type="button"
            @click="$emit('delete-profile')"
          >
            <Trash2 :size="13" /> 删除此配置
          </button>
        </div>

        <div class="va-console__foot-right">
          <button
            class="va-console__btn-ghost"
            :disabled="isTestingConnection"
            type="button"
            @click="$emit('test')"
          >
            <Loader2 v-if="isTestingConnection" :size="13" class="va-console__spin" />
            <Zap v-else :size="13" />
            <span>测试连通性</span>
          </button>
          <button class="va-console__btn-ghost" type="button" @click="$emit('close')">
            取消
          </button>
          <button class="va-console__btn-primary" type="button" @click="$emit('save')">
            保存配置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
