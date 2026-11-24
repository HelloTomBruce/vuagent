<script setup lang="ts">
/**
 * 示例场景组件：微服务部署与健康巡检卡片 (ui_deploy_status)
 * 体现 vuagent 开放场景组件能力：大模型执行工具后下发数据，由业务端自定义组件完成高质感渲染。
 */
import { ref, computed } from "vue";
import { Server, Check, Copy, RefreshCw } from "lucide-vue-next";

export interface DeployStatusProps {
  serviceName: string;
  environment: "staging" | "production" | "preview" | string;
  version: string;
  status: "deploying" | "healthy" | "degraded" | "failed" | string;
  endpoints?: string[];
  metrics?: {
    cpu?: string;
    memory?: string;
    replicas?: string;
  };
  commit?: {
    hash?: string;
    message?: string;
    author?: string;
  };
}

const props = withDefaults(defineProps<DeployStatusProps>(), {
  endpoints: () => [],
  metrics: () => ({ cpu: "12%", memory: "256 MB", replicas: "2/2 Ready" }),
});

const copiedEndpoint = ref<string | null>(null);
const isRefreshing = ref(false);

const statusMeta = computed(() => {
  switch (props.status) {
    case "healthy":
      return { label: "健康运行", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", pulse: true };
    case "deploying":
      return { label: "部署更新中", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", spin: true };
    case "degraded":
      return { label: "性能降级", color: "#d97706", bg: "#fffbeb", border: "#fde68a" };
    case "failed":
      return { label: "服务异常", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" };
    default:
      return { label: props.status, color: "#64748b", bg: "#f8fafc", border: "#e2e8f0" };
  }
});

const envMeta = computed(() => {
  switch (props.environment) {
    case "production":
      return { label: "PROD 生产", bg: "#fee2e2", color: "#991b1b" };
    case "staging":
      return { label: "STAGE 预发", bg: "#e0e7ff", color: "#3730a3" };
    case "preview":
      return { label: "PREVIEW 预览", bg: "#f3e8ff", color: "#6b21a8" };
    default:
      return { label: props.environment.toUpperCase(), bg: "#f1f5f9", color: "#334155" };
  }
});

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    copiedEndpoint.value = url;
    setTimeout(() => {
      if (copiedEndpoint.value === url) copiedEndpoint.value = null;
    }, 2000);
  } catch {
    // 忽略异常
  }
}

function handleRefresh() {
  isRefreshing.value = true;
  setTimeout(() => {
    isRefreshing.value = false;
  }, 800);
}
</script>

<template>
  <div class="va-deploy-card">
    <!-- 头部：服务名与环境/状态徽标 -->
    <div class="va-deploy-card__header">
      <div class="va-deploy-card__title-row">
        <div class="va-deploy-card__icon-wrap">
          <Server :size="16" />
        </div>
        <div class="va-deploy-card__name-block">
          <span class="va-deploy-card__name">{{ serviceName }}</span>
          <span class="va-deploy-card__version">{{ version }}</span>
        </div>
        <span class="va-deploy-card__badge-scene">场景组件 UI</span>
      </div>

      <div class="va-deploy-card__status-row">
        <span
          class="va-deploy-card__env"
          :style="{ backgroundColor: envMeta.bg, color: envMeta.color }"
        >
          {{ envMeta.label }}
        </span>
        <span
          class="va-deploy-card__status"
          :style="{
            backgroundColor: statusMeta.bg,
            color: statusMeta.color,
            borderColor: statusMeta.border,
          }"
        >
          <span
            class="va-deploy-card__status-dot"
            :class="{ 'va-deploy-card__status-dot--pulse': statusMeta.pulse }"
            :style="{ backgroundColor: statusMeta.color }"
          />
          {{ statusMeta.label }}
        </span>
      </div>
    </div>

    <!-- 关键运行指标 (3 宫格) -->
    <div class="va-deploy-card__metrics">
      <div class="va-deploy-card__metric-item">
        <span class="va-deploy-card__metric-label">实例副本</span>
        <span class="va-deploy-card__metric-val">{{ metrics?.replicas || "1/1" }}</span>
      </div>
      <div class="va-deploy-card__metric-item">
        <span class="va-deploy-card__metric-label">CPU 负载</span>
        <span class="va-deploy-card__metric-val">{{ metrics?.cpu || "8%" }}</span>
      </div>
      <div class="va-deploy-card__metric-item">
        <span class="va-deploy-card__metric-label">内存占用</span>
        <span class="va-deploy-card__metric-val">{{ metrics?.memory || "180 MB" }}</span>
      </div>
    </div>

    <!-- 服务访问端点 -->
    <div v-if="endpoints && endpoints.length > 0" class="va-deploy-card__section">
      <span class="va-deploy-card__sec-title">服务访问入口</span>
      <div class="va-deploy-card__endpoints">
        <div v-for="url in endpoints" :key="url" class="va-deploy-card__endpoint-row">
          <span class="va-deploy-card__endpoint-url" :title="url">{{ url }}</span>
          <button
            type="button"
            class="va-deploy-card__btn-copy"
            :title="copiedEndpoint === url ? '已复制' : '复制端点'"
            @click="copyUrl(url)"
          >
            <Check v-if="copiedEndpoint === url" :size="12" style="color: #16a34a" />
            <Copy v-else :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- Git 提交摘要 -->
    <div v-if="commit" class="va-deploy-card__commit">
      <span class="va-deploy-card__commit-hash">#{{ commit.hash }}</span>
      <span class="va-deploy-card__commit-msg">{{ commit.message }}</span>
      <span v-if="commit.author" class="va-deploy-card__commit-author">by {{ commit.author }}</span>
    </div>

    <!-- 底部微交互操作栏 -->
    <div class="va-deploy-card__footer">
      <button
        type="button"
        class="va-deploy-card__action-btn"
        :disabled="isRefreshing"
        @click="handleRefresh"
      >
        <RefreshCw :size="12" :class="{ 'va-spin': isRefreshing }" />
        <span>{{ isRefreshing ? "正在探针巡检…" : "探针巡检" }}</span>
      </button>
      <span class="va-deploy-card__footer-hint">由 @vuagent/ui CardRegistry 动态挂载</span>
    </div>
  </div>
</template>

<style scoped>
.va-deploy-card {
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--va-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.04));
  font-family: inherit;
}

.va-deploy-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--va-edge-subtle, rgba(26, 25, 23, 0.06));
}

.va-deploy-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.va-deploy-card__icon-wrap {
  width: 28px;
  height: 28px;
  border-radius: var(--va-radius-md, 6px);
  background: var(--va-bg-subtle, #efede7);
  color: var(--va-ink, #1a1917);
  display: flex;
  align-items: center;
  justify-content: center;
}

.va-deploy-card__name-block {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.va-deploy-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--va-ink, #1a1917);
  font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.va-deploy-card__version {
  font-size: 11px;
  color: var(--va-muted, #6f6d66);
  font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.va-deploy-card__badge-scene {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--va-radius-pill, 999px);
  background: #f3e8ff;
  color: #7e22ce;
  font-weight: 500;
}

.va-deploy-card__status-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.va-deploy-card__env {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
}

.va-deploy-card__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--va-radius-pill, 999px);
  border: 1px solid;
}

.va-deploy-card__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.va-deploy-card__status-dot--pulse {
  animation: vaDeployCardPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes vaDeployCardPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.va-deploy-card__metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.va-deploy-card__metric-item {
  background: var(--va-bg-subtle, #efede7);
  border: 1px solid var(--va-edge-subtle, rgba(26, 25, 23, 0.05));
  border-radius: var(--va-radius-md, 6px);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.va-deploy-card__metric-label {
  font-size: 11px;
  color: var(--va-muted, #6f6d66);
}

.va-deploy-card__metric-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--va-ink, #1a1917);
  font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.va-deploy-card__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.va-deploy-card__sec-title {
  font-size: 11px;
  font-weight: 500;
  color: var(--va-muted, #6f6d66);
}

.va-deploy-card__endpoints {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.va-deploy-card__endpoint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--va-bg-subtle, #efede7);
  border: 1px solid var(--va-edge-subtle, rgba(26, 25, 23, 0.05));
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--va-ink, #1a1917);
}

.va-deploy-card__endpoint-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.va-deploy-card__btn-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--va-muted, #6f6d66);
}
.va-deploy-card__btn-copy:hover {
  background: rgba(0, 0, 0, 0.06);
}

.va-deploy-card__commit {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 6px 10px;
  background: var(--va-bg-subtle, #efede7);
  border-radius: 4px;
  color: var(--va-ink-2, #43413c);
}

.va-deploy-card__commit-hash {
  font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-weight: 600;
  color: var(--va-info, #2563eb);
}

.va-deploy-card__commit-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.va-deploy-card__commit-author {
  color: var(--va-muted, #6f6d66);
}

.va-deploy-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--va-edge-subtle, rgba(26, 25, 23, 0.06));
}

.va-deploy-card__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--va-bg-subtle, #efede7);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  color: var(--va-ink-2, #43413c);
  cursor: pointer;
}
.va-deploy-card__action-btn:hover {
  background: var(--va-edge-subtle, #e2e8f0);
}

.va-deploy-card__footer-hint {
  font-size: 10px;
  color: var(--va-muted, #6f6d66);
}

.va-spin {
  animation: vaSpin 1s linear infinite;
}
@keyframes vaSpin {
  100% { transform: rotate(360deg); }
}
</style>
