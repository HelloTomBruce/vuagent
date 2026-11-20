<script setup lang="ts">
/**
 * 用量面板（TASK-075）：右侧栏「用量」tab
 * - 窗口切换：预设滚动窗口（VaSegmentedControl）+ 自定义日期区间（VaDateRangePicker）
 * - KPI：token / 费用大数（VaNumberTicker 滚动动效）；按模型成本分解（VaBreakdownChart）
 * - 配额水位：finops.windowTokenLimit / windowUsdLimit 生效值 > 0 时渲染（VaUsageMeter）
 * - 加载态：VaSkeleton（语义性加载占位）
 * - 数据域由 Console 单实例持有经 prop 下发（与消息区迷你占比条共享）
 */
import { computed } from "vue";
import {
  VaBreakdownChart,
  VaDateRangePicker,
  VaNumberTicker,
  VaSegmentedControl,
  VaSkeleton,
  VaUsageMeter,
  formatTokens,
} from "@vuagent/ui";
import type { UsageState, UsageWindowPreset } from "../composables/useUsage";

const props = defineProps<{ usage: UsageState }>();

const presetOptions: Array<{ value: string; label: string }> = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

const activeSegment = computed(() => (props.usage.isCustom.value ? "" : props.usage.preset.value));

function onPreset(value: string | number) {
  props.usage.setPreset(String(value) as UsageWindowPreset);
}

function onCustomRange(range: { start: number; end: number }) {
  props.usage.setCustomRange(range.start, range.end);
}

const tokensTotal = computed(() => props.usage.summary.value?.tokens ?? 0);
const costTotal = computed(() => props.usage.summary.value?.costUsd ?? 0);
const recordCount = computed(() => props.usage.summary.value?.recordCount ?? 0);

/** 按模型成本分解（USD，降序，4 位小数防浮点尾差） */
const costByModel = computed(() =>
  Object.entries(props.usage.summary.value?.byModel ?? {})
    .map(([label, u]) => ({ label, value: Number(u.costUsd.toFixed(4)) }))
    .sort((a, b) => b.value - a.value)
);

/** 配额水位（limit=0 不限则隐藏）：used 取准入口径（config.windowMs 窗口），非分析窗口 */
function humanWindow(ms: number): string {
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} 小时`;
  return `${Math.round(ms / 86_400_000)} 天`;
}
const quotaPeriod = computed(() => `准入窗口 · ${humanWindow(props.usage.limits.value.windowMs)} · 超限新请求 429`);
const tokenQuota = computed(() => {
  const limit = props.usage.limits.value.windowTokenLimit;
  return limit > 0 ? { limit, used: props.usage.quotaUsage.value?.tokens ?? 0 } : null;
});
const usdQuota = computed(() => {
  const limit = props.usage.limits.value.windowUsdLimit;
  return limit > 0 ? { limit, used: props.usage.quotaUsage.value?.costUsd ?? 0 } : null;
});
</script>

<template>
  <div class="va-usage">
    <!-- 窗口切换：预设 + 自定义日期 -->
    <div class="va-usage__window">
      <VaSegmentedControl
        size="sm"
        full-width
        aria-label="统计窗口"
        :options="presetOptions"
        :model-value="activeSegment"
        @update:model-value="onPreset"
      />
      <VaDateRangePicker :months="1" @change="onCustomRange" />
    </div>
    <p class="va-usage__hint">
      {{ usage.isCustom.value ? "自定义日期区间" : "滚动窗口 · 截止此刻" }}
      <template v-if="recordCount > 0">· {{ recordCount }} 轮</template>
    </p>

    <!-- 加载骨架（首次加载无数据时） -->
    <div v-if="usage.loading.value && !usage.summary.value" class="va-usage__loading" aria-label="加载用量数据">
      <VaSkeleton :height="44" radius="8px" />
      <VaSkeleton :height="44" radius="8px" />
      <VaSkeleton :height="72" radius="8px" />
    </div>

    <template v-else>
      <!-- KPI：token / 费用 -->
      <div class="va-usage__kpis">
        <div class="va-usage__kpi">
          <span class="va-usage__kpi-label">Tokens</span>
          <VaNumberTicker
            class="va-usage__kpi-value"
            :value="tokensTotal"
            :format="{ notation: 'compact', maximumFractionDigits: 1 }"
          />
          <span class="va-usage__kpi-sub">{{ formatTokens(tokensTotal) }}</span>
        </div>
        <div class="va-usage__kpi">
          <span class="va-usage__kpi-label">Cost</span>
          <VaNumberTicker
            class="va-usage__kpi-value"
            :value="costTotal"
            :format="{ style: 'currency', currency: 'USD' }"
          />
          <span class="va-usage__kpi-sub">USD · 计价表命中才记钱</span>
        </div>
      </div>

      <!-- 配额水位 -->
      <div v-if="tokenQuota" class="va-usage__quota">
        <VaUsageMeter
          :segments="[{ label: 'Tokens', used: tokenQuota.used }]"
          :limit="tokenQuota.limit"
          unit="tokens"
          :period="quotaPeriod"
        />
      </div>
      <div v-if="usdQuota" class="va-usage__quota">
        <VaUsageMeter
          :segments="[{ label: 'Cost', used: usdQuota.used }]"
          :limit="usdQuota.limit"
          unit="USD"
          :period="quotaPeriod"
        />
      </div>
      <p v-if="!tokenQuota && !usdQuota" class="va-usage__hint">
        未设配额（设置 → 执行 → 成本配额：设窗口 Token/费用上限，达到后新请求 429 拒绝）
      </p>

      <!-- 按模型成本分解 -->
      <div v-if="costByModel.length > 0" class="va-usage__breakdown">
        <VaBreakdownChart :items="costByModel" unit="USD" bar-scale="max" :max-rows="5" />
      </div>
      <div v-else class="va-console__rtab-empty">
        <p>所选窗口内暂无用量记录</p>
      </div>
    </template>
  </div>
</template>

<style>
/* TASK-075 用量面板（右栏 tab 宽度约束下的紧凑布局） */
.va-usage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
}
.va-usage__window {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.va-usage__hint {
  margin: 0;
  font-size: 11px;
  color: var(--va-text-muted, #6b7280);
}
.va-usage__loading {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.va-usage__kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.va-usage__kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--va-border, #e5e7eb);
  border-radius: 8px;
  min-width: 0;
}
.va-usage__kpi-label {
  font-size: 11px;
  color: var(--va-text-muted, #6b7280);
}
.va-usage__kpi-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
}
.va-usage__kpi-sub {
  font-size: 10px;
  color: var(--va-text-muted, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.va-usage__quota {
  min-width: 0;
}
.va-usage__breakdown {
  min-width: 0;
}
</style>
