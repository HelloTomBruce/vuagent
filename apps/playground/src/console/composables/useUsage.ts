/**
 * 成本用量数据域（TASK-075）：/api/finops/summary 首次前端消费
 * - 窗口形态：预设滚动窗口（24h/7d/30d，自此刻回溯、无上界）或自定义日期区间
 *   [start 00:00, end 次日 00:00)——对应服务端 since/until 出口
 * - 配额分母来自配置中心 finops 命名空间生效值（0 = 不限，配额条隐藏）
 * - Console 单实例持有并下发（右侧栏用量 tab + 消息区顶部迷你占比条共享一份数据）
 */
import { computed, ref } from "vue";
import {
  fetchFinopsSummary,
  fetchFinopsLimits,
  type FinopsLimits,
  type FinopsSummary,
} from "../api/client";

export type UsageWindowPreset = "24h" | "7d" | "30d";

const PRESET_WINDOW_MS: Record<UsageWindowPreset, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

/** 当日结束时刻（次日 00:00，作为区间开上界） */
function dayEnd(dayStart: number): number {
  return dayStart + 86_400_000;
}

export function useUsage() {
  const preset = ref<UsageWindowPreset>("24h");
  /** 自定义区间（当日 00:00 时间戳；非空即视为自定义模式） */
  const customStart = ref<number | null>(null);
  const customEnd = ref<number | null>(null);
  const summary = ref<FinopsSummary | null>(null);
  const limits = ref<FinopsLimits>({
    windowTokenLimit: 0,
    windowUsdLimit: 0,
    windowMs: 86_400_000,
  });
  const loading = ref(false);
  /**
   * 配额水位口径（与准入 429 同源）：固定按配置中心 finops.windowMs 汇总，
   * 独立于上方分析窗口——准入判断用的是 config 窗口，水位条不得跟随分析窗口漂移
   */
  const quotaUsage = ref<FinopsSummary | null>(null);

  const isCustom = computed(() => customStart.value != null && customEnd.value != null);

  /** 按模型 token 分解（降序）——迷你占比条与面板共用 */
  const byModelTokens = computed(() =>
    Object.entries(summary.value?.byModel ?? {})
      .map(([label, u]) => ({ label, value: u.tokens }))
      .sort((a, b) => b.value - a.value)
  );

  async function refresh() {
    loading.value = true;
    try {
      summary.value = isCustom.value
        ? await fetchFinopsSummary({
            since: customStart.value!,
            until: dayEnd(customEnd.value!),
          })
        : await fetchFinopsSummary({ windowMs: PRESET_WINDOW_MS[preset.value] });
      // 配额水位同步刷新（准入口径窗口 ≠ 分析窗口）
      void refreshQuotaUsage();
    } finally {
      loading.value = false;
    }
  }

  /** 按配置配额窗口拉取准入口径用量；未设配额则清空 */
  async function refreshQuotaUsage() {
    const hasQuota = limits.value.windowTokenLimit > 0 || limits.value.windowUsdLimit > 0;
    quotaUsage.value = hasQuota
      ? await fetchFinopsSummary({ windowMs: limits.value.windowMs })
      : null;
  }

  /** 切预设滚动窗口（清除自定义区间） */
  function setPreset(p: UsageWindowPreset) {
    preset.value = p;
    customStart.value = null;
    customEnd.value = null;
    void refresh();
  }

  /** 切自定义日期区间（end 为当日 00:00，闭区间至全天结束） */
  function setCustomRange(start: number, end: number) {
    customStart.value = start;
    customEnd.value = end;
    void refresh();
  }

  async function refreshLimits() {
    limits.value = await fetchFinopsLimits();
    await refreshQuotaUsage();
  }

  return {
    preset,
    customStart,
    customEnd,
    isCustom,
    summary,
    limits,
    quotaUsage,
    loading,
    byModelTokens,
    refresh,
    setPreset,
    setCustomRange,
    refreshLimits,
  };
}

export type UsageState = ReturnType<typeof useUsage>;
