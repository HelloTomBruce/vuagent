<script setup lang="ts">
import { AlertOctagon } from "lucide-vue-next";

export interface IncidentItem {
  id: string;
  severity: "critical" | "warning" | "info" | string;
  title: string;
  time: string;
  status: "firing" | "resolved" | "watching" | string;
  detail?: string;
}

withDefaults(
  defineProps<{ serviceName?: string; incidents?: IncidentItem[] }>(),
  { serviceName: "", incidents: () => [] }
);

const SEVERITY: Record<string, { label: string; cls: string }> = {
  critical: { label: "严重", cls: "inc--critical" },
  warning: { label: "警告", cls: "inc--warning" },
  info: { label: "信息", cls: "inc--info" },
};
</script>

<template>
  <div class="inc-card">
    <div class="inc-card__head">
      <AlertOctagon :size="15" />
      <div>
        <div class="inc-card__title">关联事件时间线<code v-if="serviceName" class="inc-card__code">{{ serviceName }}</code></div>
        <div class="inc-card__meta">近 24 小时 · 与当前告警按时间与根因相关性排列</div>
      </div>
    </div>

    <div class="inc-timeline">
      <div v-for="inc in incidents" :key="inc.id" class="inc-row" :class="SEVERITY[inc.severity]?.cls">
        <div class="inc-row__rail"><span class="inc-row__dot" /><span class="inc-row__time">{{ inc.time }}</span></div>
        <div class="inc-row__body">
          <div class="inc-row__head">
            <span class="inc-row__id">{{ inc.id }}</span>
            <span class="inc-row__title">{{ inc.title }}</span>
            <span class="inc-row__status">{{ inc.status === "firing" ? "触发中" : inc.status === "resolved" ? "已恢复" : "观察中" }}</span>
          </div>
          <p v-if="inc.detail" class="inc-row__detail">{{ inc.detail }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inc-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.inc-card__head { display: flex; align-items: flex-start; gap: 8px; }
.inc-card__head svg { color: #dc2626; margin-top: 2px; }
.inc-card__title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.inc-card__code { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; }
.inc-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }

.inc-timeline { display: flex; flex-direction: column; }
.inc-row { display: flex; gap: 10px; padding: 8px 0; border-top: 1px dashed var(--gv-border, #eee); }
.inc-row:first-child { border-top: none; }

.inc-row__rail { width: 46px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.inc-row__dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; }
.inc-row__time { font-size: 10px; font-family: var(--va-font-mono, monospace); color: var(--gv-muted); }

.inc--critical .inc-row__dot { background: #dc2626; box-shadow: 0 0 0 3px #fee2e2; }
.inc--warning .inc-row__dot { background: #f59e0b; box-shadow: 0 0 0 3px #fef3c7; }
.inc--info .inc-row__dot { background: #38bdf8; }

.inc-row__body { min-width: 0; flex: 1; }
.inc-row__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.inc-row__id { font-size: 10px; font-family: var(--va-font-mono, monospace); color: var(--gv-muted); }
.inc-row__title { font-size: 12px; font-weight: 600; }
.inc-row__status { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: #f1f5f9; color: #475569; }
.inc--critical .inc-row__status { background: #fee2e2; color: #991b1b; }
.inc--warning .inc-row__status { background: #fef3c7; color: #92400e; }
.inc-row__detail { font-size: 11px; color: var(--gv-muted); margin: 3px 0 0; line-height: 1.5; }
</style>
