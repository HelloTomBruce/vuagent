import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { DateRangePreset, DateRangePickerProps } from "./types";

/** 当日 00:00（本地时区） */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return dayStart(d.getTime());
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DayCell {
  ts: number;
  day: number;
  inMonth: boolean;
}

/** 某月的 6×7 网格（周一起始，补齐前后月） */
export function monthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // 周一=0
  const start = addDays(first.getTime(), -startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const ts = addDays(start, i);
    const d = new Date(ts);
    return { ts, day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

const DEFAULT_PRESETS: DateRangePreset[] = [
  { id: "today", label: "今天", from: 0, to: 0 },
  { id: "7d", label: "近 7 天", from: -6, to: 0 },
  { id: "30d", label: "近 30 天", from: -29, to: 0 },
];

interface RangeEmitter {
  start: (v: number) => void;
  end: (v: number) => void;
  change: (r: { start: number; end: number }) => void;
}

/**
 * VaDateRangePicker 状态：双月网格 + 两次点击选范围（start → end，反向自动交换）+
 * 预设快捷 + 悬停预览；SSR 安全（document 监听在 onMounted 挂）。
 */
export function useDateRange(props: DateRangePickerProps, rootEl: Ref<HTMLElement | null>) {
  const open = ref(false);

  /** 左侧展示月 [年, 月]：初始停在 end/start 所在月或当月 */
  const anchor = ref<[number, number]>((() => {
    const base = props.end ?? props.start ?? Date.now();
    const d = new Date(base);
    return [d.getFullYear(), d.getMonth()];
  })());

  const presets = computed(() => [...DEFAULT_PRESETS, ...(props.presets ?? [])]);

  const leftGrid = computed(() => monthGrid(anchor.value[0], anchor.value[1]));
  const rightGrid = computed(() => {
    const [y, m] = anchor.value;
    return monthGrid(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1);
  });

  const monthLabel = (offset: number) => {
    const [y, m] = anchor.value;
    const nm = m + offset;
    const ny = nm < 0 ? y - 1 : nm > 11 ? y + 1 : y;
    return `${ny} 年 ${(((nm % 12) + 12) % 12) + 1} 月`;
  };

  function shiftMonth(delta: number) {
    const [y, m] = anchor.value;
    const nm = m + delta;
    anchor.value = [nm < 0 ? y - 1 : nm > 11 ? y + 1 : y, ((nm % 12) + 12) % 12];
  }

  const summary = computed(() => {
    if (props.start !== undefined && props.end !== undefined) return `${fmtDate(props.start)} → ${fmtDate(props.end)}`;
    return props.placeholder ?? "选择日期范围";
  });

  /** 半选起点：起点已点、终点未点（悬停预览区间） */
  const pendingStart = ref<number | null>(null);
  const hoverTs = ref<number | null>(null);

  function onPick(ts: number, emit: RangeEmitter) {
    if (pendingStart.value === null) {
      pendingStart.value = ts;
      emit.start(ts);
      emit.end(ts);
      emit.change({ start: ts, end: ts });
    } else {
      const [s, e] = pendingStart.value <= ts ? [pendingStart.value, ts] : [ts, pendingStart.value];
      pendingStart.value = null;
      emit.start(s);
      emit.end(e);
      emit.change({ start: s, end: e });
      open.value = false;
    }
  }

  function applyPreset(p: DateRangePreset, emit: RangeEmitter) {
    const today = dayStart(Date.now());
    const from = addDays(today, p.from);
    const to = addDays(today, p.to);
    pendingStart.value = null;
    emit.start(from);
    emit.end(to);
    emit.change({ start: from, end: to });
    open.value = false;
  }

  /** 格子状态：起/终/区间内 */
  function cellState(ts: number): "start" | "end" | "in" | "" {
    const s = pendingStart.value ?? props.start;
    const e = pendingStart.value !== null ? hoverTs.value : props.end;
    if (s !== undefined && ts === s) return "start";
    if (e !== null && e !== undefined && ts === e) return "end";
    if (s !== undefined && e !== null && e !== undefined && ts > s && ts < e) return "in";
    return "";
  }

  /* 外部点击关闭 */
  const onDocMousedown = (ev: MouseEvent) => {
    if (open.value && rootEl.value && !rootEl.value.contains(ev.target as Node)) open.value = false;
  };
  onMounted(() => {
    if (typeof document !== "undefined") document.addEventListener("mousedown", onDocMousedown);
  });
  onBeforeUnmount(() => {
    if (typeof document !== "undefined") document.removeEventListener("mousedown", onDocMousedown);
  });

  /* 外部范围变化时同步半选态 */
  watch(
    () => [props.start, props.end],
    () => {
      if (props.start === undefined || props.end === undefined) pendingStart.value = props.start ?? null;
    },
    { immediate: true },
  );

  return {
    open,
    anchor,
    presets,
    leftGrid,
    rightGrid,
    monthLabel,
    summary,
    shiftMonth,
    onPick,
    applyPreset,
    hoverTs,
    cellState,
  };
}
