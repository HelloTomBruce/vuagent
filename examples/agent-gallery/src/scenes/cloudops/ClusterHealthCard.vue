<script setup lang="ts">
import { computed } from "vue";
import { Server, Activity, AlertTriangle, Cpu, HardDrive, ShieldCheck } from "lucide-vue-next";

export interface PodItem {
  name: string;
  status: "running" | "warning" | "failed" | string;
  restarts: number;
  node: string;
  cpu: string;
  mem: string;
}

export interface ClusterHealthProps {
  serviceName?: string;
  namespace?: string;
  cluster?: string;
  version?: string;
  status?: "healthy" | "degraded" | "critical" | string;
  cpuUsage?: string;
  memoryUsage?: string;
  replicaSummary?: string;
  pods?: PodItem[];
  alerts?: string[];
  readonly?: boolean;
}

const props = withDefaults(defineProps<ClusterHealthProps>(), {
  serviceName: "order-service",
  namespace: "production",
  cluster: "k8s-prod-cluster-01",
  version: "v1.28.4",
  status: "degraded",
  cpuUsage: "78%",
  memoryUsage: "94%",
  replicaSummary: "2/2 Ready",
  pods: () => [],
  alerts: () => [],
  readonly: false,
});

const emit = defineEmits<{
  (e: "action", payload: { action: string; targetReplicas: number }): void;
}>();

const isDegraded = computed(() => props.status === "degraded" || props.status === "critical");

function handleQuickScale() {
  emit("action", {
    action: "scale",
    targetReplicas: 5,
  });
}
</script>

<template>
  <div class="ops-cluster-card" :class="{ 'ops-cluster-card--warning': isDegraded }">
    <!-- 头部：服务标识与状态徽标 -->
    <div class="ops-cluster-card__header">
      <div class="ops-cluster-card__title-box">
        <div class="ops-cluster-card__icon-wrap">
          <Server :size="16" />
        </div>
        <div>
          <div class="ops-cluster-card__name-row">
            <span class="ops-cluster-card__service-name">{{ serviceName }}</span>
            <span class="ops-cluster-card__badge-ns">{{ namespace }}</span>
          </div>
          <div class="ops-cluster-card__meta-row">
            <span>{{ cluster }}</span>
            <span>·</span>
            <span>K8s {{ version }}</span>
          </div>
        </div>
      </div>

      <div class="ops-cluster-card__status-tag" :class="isDegraded ? 'ops-tag--warn' : 'ops-tag--ok'">
        <span class="ops-tag__dot" />
        <span>{{ isDegraded ? "负载预警 (Degraded)" : "正常运行 (Healthy)" }}</span>
      </div>
    </div>

    <!-- 关键指标条 (CPU & 内存) -->
    <div class="ops-cluster-card__metrics-grid">
      <div class="ops-metric-card">
        <div class="ops-metric-card__label">
          <Cpu :size="13" />
          <span>CPU 利用率</span>
        </div>
        <div class="ops-metric-card__val">{{ cpuUsage }}</div>
        <div class="ops-metric-bar">
          <div class="ops-metric-bar__fill" :style="{ width: cpuUsage, background: '#3b82f6' }" />
        </div>
      </div>

      <div class="ops-metric-card ops-metric-card--alert">
        <div class="ops-metric-card__label">
          <HardDrive :size="13" />
          <span>内存使用率 (高危)</span>
        </div>
        <div class="ops-metric-card__val text-danger">{{ memoryUsage }}</div>
        <div class="ops-metric-bar">
          <div class="ops-metric-bar__fill" :style="{ width: memoryUsage, background: '#ef4444' }" />
        </div>
      </div>
    </div>

    <!-- Pod 实例拓扑列表 -->
    <div v-if="pods && pods.length > 0" class="ops-cluster-card__pods-sec">
      <div class="ops-section-title">
        <Activity :size="12" />
        <span>Pod 实例分布 ({{ replicaSummary }})</span>
      </div>
      <div class="ops-pods-table">
        <div class="ops-pods-row ops-pods-row--head">
          <span>实例名</span>
          <span>节点</span>
          <span>重启</span>
          <span>资源消耗</span>
        </div>
        <div
          v-for="pod in pods"
          :key="pod.name"
          class="ops-pods-row"
          :class="{ 'ops-pods-row--warn': pod.status === 'warning' }"
        >
          <span class="ops-pod-name" :title="pod.name">{{ pod.name }}</span>
          <span class="ops-pod-node">{{ pod.node }}</span>
          <span class="ops-pod-restarts">{{ pod.restarts }}</span>
          <span class="ops-pod-res">CPU {{ pod.cpu }} · MEM {{ pod.mem }}</span>
        </div>
      </div>
    </div>

    <!-- 诊断告警提示 -->
    <div v-if="alerts && alerts.length > 0" class="ops-cluster-card__alerts">
      <div v-for="(alert, i) in alerts" :key="i" class="ops-alert-item">
        <AlertTriangle :size="14" class="ops-alert-icon" />
        <span>{{ alert }}</span>
      </div>
    </div>

    <!-- 底部快捷动作（可选交互） -->
    <div v-if="!readonly" class="ops-cluster-card__footer">
      <div class="ops-footer-hint">
        <ShieldCheck :size="13" />
        <span>建议在下方输入：扩容该微服务以分流负载</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ops-cluster-card {
  border: 1px solid var(--va-edge, #e2e8f0);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  font-family: inherit;
  margin: 6px 0;
}

.ops-cluster-card--warning {
  border-color: #fca5a5;
  background: linear-gradient(180deg, #fffafa 0%, #ffffff 100%);
}

.ops-cluster-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid var(--va-edge-subtle, #f1f5f9);
  padding-bottom: 12px;
}

.ops-cluster-card__title-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ops-cluster-card__icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #f1f5f9;
  color: #1e293b;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ops-cluster-card__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ops-cluster-card__service-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  font-family: var(--va-font-mono, monospace);
}

.ops-cluster-card__badge-ns {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #475569;
}

.ops-cluster-card__meta-row {
  font-size: 11px;
  color: #64748b;
  display: flex;
  gap: 4px;
}

.ops-cluster-card__status-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.ops-tag--warn {
  background: #fee2e2;
  color: #991b1b;
}

.ops-tag--ok {
  background: #dcfce7;
  color: #166534;
}

.ops-tag__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.ops-cluster-card__metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.ops-metric-card {
  background: var(--va-bg-subtle, #f8fafc);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ops-metric-card--alert {
  border-color: #fecaca;
  background: #fff5f5;
}

.ops-metric-card__label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #64748b;
}

.ops-metric-card__val {
  font-size: 16px;
  font-weight: 600;
  font-family: var(--va-font-mono, monospace);
  color: #1e293b;
}

.text-danger {
  color: #dc2626;
}

.ops-metric-bar {
  height: 4px;
  border-radius: 2px;
  background: #e2e8f0;
  overflow: hidden;
  margin-top: 2px;
}

.ops-metric-bar__fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.ops-cluster-card__pods-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ops-section-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
}

.ops-pods-table {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
  font-size: 11px;
}

.ops-pods-row {
  display: grid;
  grid-template-columns: 1.8fr 1.2fr 0.6fr 2fr;
  padding: 6px 10px;
  align-items: center;
  background: #ffffff;
  border-bottom: 1px solid #f1f5f9;
}

.ops-pods-row:last-child {
  border-bottom: none;
}

.ops-pods-row--head {
  background: #f8fafc;
  color: #64748b;
  font-weight: 600;
}

.ops-pods-row--warn {
  background: #fff7ed;
  color: #9a3412;
}

.ops-pod-name {
  font-family: var(--va-font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ops-cluster-card__alerts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ops-alert-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  padding: 6px 10px;
  background: #fef2f2;
  border-radius: 6px;
  color: #991b1b;
  line-height: 1.4;
}

.ops-alert-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.ops-cluster-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #f1f5f9;
  padding-top: 8px;
}

.ops-footer-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #64748b;
}
</style>
