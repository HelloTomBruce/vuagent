<script setup lang="ts">
import { ref } from "vue";
import { ArrowRight, CheckCircle2, RefreshCw, Server, ShieldCheck, Zap } from "lucide-vue-next";

export interface CanaryDeployProps {
  serviceName?: string;
  currentReplicas?: number;
  targetReplicas?: number;
  status?: "deploying" | "completed" | "failed" | string;
  strategy?: string;
  reason?: string;
  metrics?: {
    cpuBefore?: string;
    cpuAfter?: string;
    memBefore?: string;
    memAfter?: string;
  };
  probes?: {
    liveness?: string;
    readiness?: string;
  };
  timeline?: Array<{
    time: string;
    event: string;
  }>;
}

const props = withDefaults(defineProps<CanaryDeployProps>(), {
  serviceName: "order-service",
  currentReplicas: 2,
  targetReplicas: 5,
  status: "completed",
  strategy: "RollingUpdate",
  reason: "业务洪峰流量紧急横向扩容",
  metrics: () => ({
    cpuBefore: "78%",
    cpuAfter: "31%",
    memBefore: "94%",
    memAfter: "38%",
  }),
  probes: () => ({
    liveness: "Passed (5/5)",
    readiness: "Passed (5/5)",
  }),
  timeline: () => [],
});

const isDone = ref(true);
</script>

<template>
  <div class="ops-deploy-card">
    <!-- 头部：扩容动作与状态 -->
    <div class="ops-deploy-card__header">
      <div class="ops-deploy-card__title-box">
        <div class="ops-deploy-card__icon-wrap">
          <Zap :size="16" />
        </div>
        <div>
          <div class="ops-deploy-card__name-row">
            <span class="ops-deploy-card__service-name">{{ serviceName }}</span>
            <span class="ops-deploy-card__strategy">{{ strategy }}</span>
          </div>
          <div class="ops-deploy-card__reason">{{ reason }}</div>
        </div>
      </div>

      <div class="ops-deploy-tag ops-deploy-tag--success">
        <CheckCircle2 :size="13" />
        <span>扩容就绪 ({{ targetReplicas }}/{{ targetReplicas }} Pods)</span>
      </div>
    </div>

    <!-- 副本实例数扩容阶梯指示器 -->
    <div class="ops-deploy-card__stepper">
      <div class="ops-step-node">
        <span class="ops-step-label">原实例规模</span>
        <span class="ops-step-val">{{ currentReplicas }} Pods</span>
      </div>
      <div class="ops-step-arrow">
        <ArrowRight :size="16" />
        <span class="ops-arrow-tag">+{{ targetReplicas - currentReplicas }} 新增</span>
      </div>
      <div class="ops-step-node ops-step-node--active">
        <span class="ops-step-label">扩容后规模</span>
        <span class="ops-step-val text-success">{{ targetReplicas }} Pods Ready</span>
      </div>
    </div>

    <!-- 资源水位对比（负载降解） -->
    <div v-if="metrics" class="ops-deploy-card__metrics-compare">
      <div class="ops-compare-item">
        <span class="ops-compare-title">CPU 利用率</span>
        <div class="ops-compare-vals">
          <span class="ops-val-old">{{ metrics.cpuBefore }}</span>
          <ArrowRight :size="12" />
          <span class="ops-val-new text-success">{{ metrics.cpuAfter }}</span>
        </div>
      </div>

      <div class="ops-compare-item">
        <span class="ops-compare-title">内存使用率 (警戒解除)</span>
        <div class="ops-compare-vals">
          <span class="ops-val-old text-danger">{{ metrics.memBefore }}</span>
          <ArrowRight :size="12" />
          <span class="ops-val-new text-success">{{ metrics.memAfter }}</span>
        </div>
      </div>
    </div>

    <!-- 健康探针与服务注册 -->
    <div v-if="probes" class="ops-deploy-card__probes">
      <div class="ops-probe-item">
        <span class="ops-probe-label">存活探针 (Liveness):</span>
        <span class="ops-probe-val text-success">{{ probes.liveness }}</span>
      </div>
      <div class="ops-probe-item">
        <span class="ops-probe-label">就绪探针 (Readiness):</span>
        <span class="ops-probe-val text-success">{{ probes.readiness }}</span>
      </div>
    </div>

    <!-- 执行事件时间轴 -->
    <div v-if="timeline && timeline.length > 0" class="ops-deploy-card__timeline">
      <div v-for="(item, i) in timeline" :key="i" class="ops-timeline-row">
        <span class="ops-timeline-time">{{ item.time }}</span>
        <span class="ops-timeline-dot" />
        <span class="ops-timeline-event">{{ item.event }}</span>
      </div>
    </div>

    <!-- 底部状态声明 -->
    <div class="ops-deploy-card__footer">
      <ShieldCheck :size="13" class="text-success" />
      <span>生产环境人工审批已确认，变更安全落地</span>
    </div>
  </div>
</template>

<style scoped>
.ops-deploy-card {
  border: 1px solid #bbf7d0;
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
  border-radius: var(--va-radius-lg, 12px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  font-family: inherit;
  margin: 6px 0;
}

.ops-deploy-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid #dcfce7;
  padding-bottom: 12px;
}

.ops-deploy-card__title-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ops-deploy-card__icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #dcfce7;
  color: #16a34a;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ops-deploy-card__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ops-deploy-card__service-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  font-family: var(--va-font-mono, monospace);
}

.ops-deploy-card__strategy {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #475569;
}

.ops-deploy-card__reason {
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
}

.ops-deploy-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.ops-deploy-tag--success {
  background: #dcfce7;
  color: #15803d;
}

.ops-deploy-card__stepper {
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 16px;
}

.ops-step-node {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
}

.ops-step-label {
  font-size: 11px;
  color: #64748b;
}

.ops-step-val {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--va-font-mono, monospace);
  color: #1e293b;
}

.ops-step-node--active .ops-step-val {
  font-size: 15px;
}

.ops-step-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #94a3b8;
  gap: 2px;
}

.ops-arrow-tag {
  font-size: 10px;
  background: #dbeafe;
  color: #1d4ed8;
  padding: 1px 5px;
  border-radius: 999px;
  font-weight: 600;
}

.ops-deploy-card__metrics-compare {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.ops-compare-item {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ops-compare-title {
  font-size: 11px;
  color: #64748b;
}

.ops-compare-vals {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: var(--va-font-mono, monospace);
  font-weight: 600;
}

.ops-val-old {
  color: #64748b;
  text-decoration: line-through;
}

.text-success {
  color: #16a34a;
}

.text-danger {
  color: #dc2626;
}

.ops-deploy-card__probes {
  display: flex;
  gap: 16px;
  font-size: 11px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 12px;
}

.ops-probe-item {
  display: flex;
  gap: 4px;
}

.ops-probe-label {
  color: #64748b;
}

.ops-probe-val {
  font-weight: 600;
  font-family: var(--va-font-mono, monospace);
}

.ops-deploy-card__timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 12px;
}

.ops-timeline-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.ops-timeline-time {
  font-family: var(--va-font-mono, monospace);
  color: #94a3b8;
  width: 45px;
  flex-shrink: 0;
}

.ops-timeline-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #16a34a;
}

.ops-timeline-event {
  color: #334155;
}

.ops-deploy-card__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #15803d;
  font-weight: 500;
}
</style>
