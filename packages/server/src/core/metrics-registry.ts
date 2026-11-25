import type { HarnessEventSink, HarnessOpsEvent } from "./event-sink.js";

/**
 * 轻量 Prometheus 指标注册表（可观测出口之一，消费 core/event-sink.ts 的运维事件流）：
 * 进程内 incCounter/setGauge 记账，renderPrometheus 输出 Prometheus 文本格式，
 * 供 /metrics 端点被 Prometheus/VictoriaMetrics 等抓取。
 *
 * 设计动机：
 * - 零依赖：内置指标面只有 6 个，手写文本渲染（~百行）比引入 prom-client 全量
 *   客户端更符合本包「零新依赖」约束，输出仍对齐 Prometheus 暴露规范
 *   （# HELP/# TYPE、标签值转义、counter/gauge 按族分组）；
 * - 输出确定性：标签键排序 + 指标族按名称排序 + 族内样本按标签组排序，
 *   同一指标状态两次渲染逐字节一致——便于 diff 审查与单测断言；
 * - 标签值来自运行时输入（工具名、档案名等），不设白名单，仅做转义防注入。
 */

/** 指标类型（counter/gauge/histogram 三类；histogram 为 TASK-097 HTTP 时延新增） */
type MetricKind = "counter" | "gauge" | "histogram";

interface MetricMetadata {
  kind: MetricKind;
  /** HELP 文案（单行；渲染时转义反斜杠与换行） */
  help: string;
}

/** 指标元数据内置表：recordOpsEvent 会写入的指标全部在此声明 HELP/TYPE */
const METRIC_METADATA: Record<string, MetricMetadata> = {
  vuagent_running_turns: {
    kind: "gauge",
    help: "Currently running turns (运行中的轮次数)",
  },
  vuagent_turns_total: {
    kind: "counter",
    help: "Finished turns by status and ops code (完成的轮次数，按收尾状态与分类码分组)",
  },
  vuagent_turn_tokens_total: {
    kind: "counter",
    help: "Total tokens consumed by turns (轮次累计 token 消耗总和，计费口径)",
  },
  vuagent_model_retries_total: {
    kind: "counter",
    help: "Model request retries by error class (模型请求重试次数，按错误分类)",
  },
  vuagent_model_fallback_total: {
    kind: "counter",
    help: "Model fallback switches between profiles (模型降级切换次数)",
  },
  vuagent_tool_calls_total: {
    kind: "counter",
    help: "Tool calls by tool and outcome (工具调用次数，按工具与成败分组)",
  },
  // ---- TASK-097 HTTP/SSE/进程指标 ----
  vuagent_http_requests_total: {
    kind: "counter",
    help: "HTTP requests by method, route template and status (HTTP 请求数，route 为路由模板防基数爆炸)",
  },
  vuagent_http_request_duration_ms: {
    kind: "histogram",
    help: "HTTP request duration in ms (HTTP 请求时延直方图)",
  },
  vuagent_sse_active_connections: {
    kind: "gauge",
    help: "Active SSE connections (活跃 SSE 连接数)",
  },
  vuagent_sse_events_total: {
    kind: "counter",
    help: "SSE events streamed by type (SSE 事件流出数，按事件类型分组)",
  },
  vuagent_eventloop_lag_ms: {
    kind: "gauge",
    help: "Event loop lag sampled periodically (事件循环延迟，周期采样)",
  },
  vuagent_process_heap_bytes: {
    kind: "gauge",
    help: "Process heap memory bytes (进程堆内存，抓取时采样)",
  },
  vuagent_process_rss_bytes: {
    kind: "gauge",
    help: "Process RSS bytes (进程常驻内存，抓取时采样)",
  },
  /** 存储域审查 R3：series 上限保险丝的溢出计量（注册表内置，仅溢出时上屏） */
  vuagent_metric_series_overflow_total: {
    kind: "counter",
    help: "Metric series dropped after reaching the per-family series cap (指标样本序列超限丢弃数，按指标名分组)",
  },
};

/** 同一标签组的样本：labelPairs 已按键排序（渲染顺序），value 为当前值 */
interface MetricSample {
  labelPairs: Array<[string, string]>;
  value: number;
}

/** histogram 样本：桶计数（与 BUCKETS 对齐）+ sum/count；le 渲染时累加为累计分布 */
interface HistogramSample {
  labelPairs: Array<[string, string]>;
  bucketCounts: number[];
  sum: number;
  count: number;
}

interface MetricFamily {
  kind: MetricKind;
  help: string;
  /** 标签组键（排序标签对的 JSON 串）→ 样本 */
  samples: Map<string, MetricSample>;
  /** histogram 专属样本（与 samples 二选一） */
  histograms?: Map<string, HistogramSample>;
}

/** HTTP 时延直方图桶边界（ms）；le 渲染为累计分布 + +Inf */
const HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/** 抓取时采样型 gauge 的采集器（TASK-097 进程内存：避免周期定时器常驻） */
type GaugeCollector = () => Array<{ labels?: Record<string, string>; value: number }>;

/** 标签值转义：Prometheus 文本格式要求 \\、"、\n 三种字符转义（先转反斜杠防二次转义） */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** HELP 文案转义：只需反斜杠与换行（双引号在 HELP 中合法） */
function escapeHelpText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** 存储域审查 R3：单个指标族的样本 series 默认上限（标签基数保险丝） */
export const DEFAULT_MAX_SERIES = 500;

/** MetricsRegistry 选项 */
export interface MetricsRegistryOptions {
  /**
   * 单个 counter/histogram 指标族允许的最大样本 series 数（存储域审查 R3）。
   * 标签值来自运行时输入，理论上无界——超限丢弃新 series 并累计 overflow_total，
   * 防御标签基数爆炸拖垮内存与 /metrics 渲染。gauge 不设限（调用面是有界标签集）。
   * 缺省 DEFAULT_MAX_SERIES。
   */
  maxSeries?: number;
}

/** series 上限溢出计数指标名（渲染为内置 counter 族，仅存在溢出时上屏） */
const SERIES_OVERFLOW_METRIC = "vuagent_metric_series_overflow_total";

export class MetricsRegistry {
  /** 指标名 → 指标族（首次写入时建档） */
  private readonly families = new Map<string, MetricFamily>();
  /** 抓取时采样型 gauge 采集器（TASK-097：进程内存等抓取时刻快照） */
  private readonly collectors = new Map<string, GaugeCollector>();
  /** 单指标族 series 上限（R3 保险丝） */
  private readonly maxSeries: number;
  /** 指标名 → 超限丢弃的新 series 数（R3：overflow_total 计量源） */
  private readonly seriesOverflow = new Map<string, number>();
  /** 已告警过的负值 counter series 键（N1：render 时 warn 一次，防重复刷屏） */
  private readonly negativeCounterWarned = new Set<string>();

  constructor(options: MetricsRegistryOptions = {}) {
    this.maxSeries = options.maxSeries ?? DEFAULT_MAX_SERIES;
  }

  /** 计数器累加（value 缺省 1；同标签组累计） */
  incCounter(name: string, labels?: Record<string, string>, value = 1): void {
    this.adjust(name, "counter", labels, (current) => current + value);
  }

  /** 仪表绝对置值（覆盖同标签组旧值） */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    this.adjust(name, "gauge", labels, () => value);
  }

  /** 仪表递增（SSE 连接建立等配对计数；N1：与 decGauge 配对，勿在 counter 上做增减） */
  incGauge(name: string, labels?: Record<string, string>, value = 1): void {
    this.adjust(name, "gauge", labels, (current) => current + value);
  }

  /** 仪表递减（SSE 连接关闭等配对计数；负值钳 0） */
  decGauge(name: string, labels?: Record<string, string>, value = 1): void {
    this.adjust(name, "gauge", labels, (current) => Math.max(0, current - value));
  }

  /**
   * histogram 观测（TASK-097）：值落入 HISTOGRAM_BUCKETS 对应桶（上限桶兜底），
   * sum/count 累计。渲染为 Prometheus histogram 三段（bucket 累计分布/_sum/_count）。
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const labelPairs: Array<[string, string]> = labels
      ? Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : [];
    const sampleKey = JSON.stringify(labelPairs);
    let family = this.families.get(name);
    if (!family || !family.histograms) {
      family = {
        kind: METRIC_METADATA[name]?.kind ?? "histogram",
        help: METRIC_METADATA[name]?.help ?? `${name} (undocumented metric)`,
        samples: new Map(),
        histograms: new Map(),
      };
      this.families.set(name, family);
    }
    const histograms = family.histograms ?? new Map<string, HistogramSample>();
    family.histograms = histograms;
    const existing = histograms.get(sampleKey);
    // R3 保险丝：新 series 且已达上限 → 丢弃并累计 overflow（已入账 series 不受影响）
    if (!existing && histograms.size >= this.maxSeries) {
      this.noteSeriesOverflow(name);
      return;
    }
    const bucketCounts = existing?.bucketCounts ?? new Array(HISTOGRAM_BUCKETS.length).fill(0);
    // 落桶：找第一个 >= value 的边界，超出全部边界归最末桶（+Inf 兜底）
    let bucketIndex = HISTOGRAM_BUCKETS.findIndex((le) => value <= le);
    if (bucketIndex < 0) bucketIndex = HISTOGRAM_BUCKETS.length - 1;
    bucketCounts[bucketIndex] += 1;
    histograms.set(sampleKey, {
      labelPairs,
      bucketCounts,
      sum: (existing?.sum ?? 0) + value,
      count: (existing?.count ?? 0) + 1,
    });
  }

  /**
   * 抓取时采样型 gauge 采集器注册（TASK-097）：renderPrometheus 每次调用 fn 取快照，
   * 不落内部状态——进程内存这类「抓取时才有意义」的指标无需周期定时器。
   */
  setGaugeCollector(name: string, collect: GaugeCollector): void {
    this.collectors.set(name, collect);
  }

  /**
   * 渲染 Prometheus 文本格式：每个指标族输出 # HELP / # TYPE 与全部样本行。
   * 族按名称排序、族内样本按标签组键排序、样本内标签按键字典序——输出完全确定。
   * 从未记录过的指标（无样本族）不输出，暴露面只含真实发生过的指标；
   * 采集器型 gauge（进程内存）只要有注册就输出。
   */
  renderPrometheus(): string {
    const lines: string[] = [];
    const familyNames = [
      ...this.families.keys(),
      ...this.collectors.keys(),
      // R3：存在溢出时内置 overflow counter 族参与统一排序渲染
      ...(this.seriesOverflow.size > 0 ? [SERIES_OVERFLOW_METRIC] : []),
    ].sort();
    for (const name of new Set(familyNames)) {
      // R3：overflow counter 族（无实际族/采集器，数据源为 seriesOverflow 计量表）
      if (name === SERIES_OVERFLOW_METRIC && this.seriesOverflow.size > 0) {
        lines.push(`# HELP ${SERIES_OVERFLOW_METRIC} ${escapeHelpText(METRIC_METADATA[SERIES_OVERFLOW_METRIC]?.help ?? `${SERIES_OVERFLOW_METRIC} (undocumented metric)`)}`);
        lines.push(`# TYPE ${SERIES_OVERFLOW_METRIC} counter`);
        for (const [metric, dropped] of [...this.seriesOverflow].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          lines.push(`${SERIES_OVERFLOW_METRIC}{metric="${escapeLabelValue(metric)}"} ${dropped}`);
        }
        continue;
      }
      const family = this.families.get(name);
      const collector = this.collectors.get(name);
      if (!family && collector) {
        lines.push(`# HELP ${name} ${escapeHelpText(METRIC_METADATA[name]?.help ?? `${name} (undocumented metric)`)}`);
        lines.push(`# TYPE ${name} gauge`);
        for (const sample of collector()) {
          const pairs = Object.entries(sample.labels ?? {}).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          );
          const rendered = pairs.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",");
          lines.push(rendered ? `${name}{${rendered}} ${sample.value}` : `${name} ${sample.value}`);
        }
        continue;
      }
      if (!family) continue;
      lines.push(`# HELP ${name} ${escapeHelpText(family.help)}`);
      lines.push(`# TYPE ${name} ${family.kind}`);
      // R3：该族发生过 series 溢出 → 渲染注释标注（抓取方可感知丢弃而非静默缺失）
      const dropped = this.seriesOverflow.get(name);
      if (dropped !== undefined) {
        lines.push(
          `# ${name}: series cap ${this.maxSeries} reached, dropped ${dropped} new series (see ${SERIES_OVERFLOW_METRIC})`
        );
      }
      // N1：counter 族出现负值 series → render 时 warn 一次（防御 incCounter/decGauge 混搭误用）
      if (family.kind === "counter") {
        for (const [key, sample] of family.samples) {
          const warnKey = `${name}\u0000${key}`;
          if (sample.value < 0 && !this.negativeCounterWarned.has(warnKey)) {
            this.negativeCounterWarned.add(warnKey);
            console.warn(
              `[vuagent-metrics] counter ${name} has a negative series value (${sample.value}); ` +
                "counter 只允许累加——增减配对计数请使用 incGauge/decGauge"
            );
          }
        }
      }
      if (family.kind === "histogram" && family.histograms) {
        for (const key of [...family.histograms.keys()].sort()) {
          const sample = family.histograms.get(key)!;
          const base = sample.labelPairs
            .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
            .join(",");
          const withLe = (le: string, value: number) =>
            base
              ? `${name}_bucket{${base},le="${le}"} ${value}`
              : `${name}_bucket{le="${le}"} ${value}`;
          let cumulative = 0;
          HISTOGRAM_BUCKETS.forEach((bucket, index) => {
            cumulative += sample.bucketCounts[index];
            lines.push(withLe(String(bucket), cumulative));
          });
          lines.push(withLe("+Inf", sample.count));
          lines.push(base ? `${name}_sum{${base}} ${sample.sum}` : `${name}_sum ${sample.sum}`);
          lines.push(base ? `${name}_count{${base}} ${sample.count}` : `${name}_count ${sample.count}`);
        }
        continue;
      }
      for (const key of [...family.samples.keys()].sort()) {
        const sample = family.samples.get(key)!;
        if (sample.labelPairs.length === 0) {
          lines.push(`${name} ${sample.value}`);
          continue;
        }
        const rendered = sample.labelPairs
          .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
          .join(",");
        lines.push(`${name}{${rendered}} ${sample.value}`);
      }
    }
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }

  /**
   * 运维事件 → 指标映射（MetricsRegistry 消费 HarnessOpsEvent 的入口）：
   * - turn_start/turn_finish 维护 running_turns 仪表并累计轮次/token 计数器；
   * - model_retry/model_fallback/tool_result 累计各自计数器；
   * - step_finish/abort/warn/error 属日志面事件，不映射指标（走 otlp-sink）。
   */
  recordOpsEvent(event: HarnessOpsEvent): void {
    switch (event.type) {
      case "turn_start":
        this.adjustGaugeDelta("vuagent_running_turns", +1);
        break;
      case "turn_finish": {
        this.adjustGaugeDelta("vuagent_running_turns", -1);
        // 收尾分类码入标签：正常收尾与各异常码是不同样本行
        const labels: Record<string, string> = { status: event.status };
        if (event.code !== undefined) labels.code = event.code;
        this.incCounter("vuagent_turns_total", labels);
        // token 计数（计费口径，跨步总和）；事件未携带则不动该计数器
        if (typeof event.totalTokens === "number") {
          this.incCounter("vuagent_turn_tokens_total", undefined, event.totalTokens);
        }
        break;
      }
      case "model_retry":
        this.incCounter("vuagent_model_retries_total", { error_class: event.errorClass });
        break;
      case "model_fallback":
        // from/to 为运行时档案名，可含任意字符 → 渲染时统一转义
        this.incCounter("vuagent_model_fallback_total", { from: event.from, to: event.to });
        break;
      case "tool_result":
        this.incCounter("vuagent_tool_calls_total", { tool: event.tool, ok: String(event.ok) });
        break;
      default:
        break;
    }
  }

  /**
   * gauge 相对调整（running_turns 的 start/finish 配对计数）：
   * 进程重启后可能收到无配对 start 的 finish，负值钳 0 保持仪表非负语义。
   */
  private adjustGaugeDelta(name: string, delta: number): void {
    this.adjust(name, "gauge", undefined, (current) => Math.max(0, current + delta));
  }

  /** 统一写入路径：按元数据表建档 → 标签键排序成样本键 → 变换现值 */
  private adjust(
    name: string,
    kind: MetricKind,
    labels: Record<string, string> | undefined,
    mutate: (current: number) => number,
  ): void {
    const labelPairs: Array<[string, string]> = labels
      ? Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : [];
    // 样本键用排序标签对的 JSON 串：免字符串拼接歧义，
    // 天然满足「同标签组归并、异标签组分样本」
    const sampleKey = JSON.stringify(labelPairs);
    let family = this.families.get(name);
    if (!family) {
      family = {
        // 已声明指标以元数据表的 TYPE/HELP 为准（防止同名混用两种类型）；
        // 运行时临时指标给占位 HELP 兜底
        kind: METRIC_METADATA[name]?.kind ?? kind,
        help: METRIC_METADATA[name]?.help ?? `${name} (undocumented metric)`,
        samples: new Map(),
      };
      this.families.set(name, family);
    }
    const existing = family.samples.get(sampleKey);
    // R3 保险丝：新 counter series 且已达上限 → 丢弃并累计 overflow；
    // 已入账 series 与 gauge（有界标签集）不受影响
    if (!existing && kind === "counter" && family.samples.size >= this.maxSeries) {
      this.noteSeriesOverflow(name);
      return;
    }
    family.samples.set(sampleKey, {
      labelPairs,
      value: mutate(existing ? existing.value : 0),
    });
  }

  /** R3：记录一次 series 溢出丢弃（overflow_total 计量源，渲染为内置 counter 族） */
  private noteSeriesOverflow(name: string): void {
    this.seriesOverflow.set(name, (this.seriesOverflow.get(name) ?? 0) + 1);
  }
}

/**
 * 把 MetricsRegistry 适配为 HarnessEventSink：
 * 供 compositeSink(consoleSink, createOpsMetricsSink(registry), otlpSink) 一行接线，
 * 运维事件在出 console/OTLP 的同时累进指标。
 */
export function createOpsMetricsSink(registry: MetricsRegistry): HarnessEventSink {
  return {
    emit(event) {
      registry.recordOpsEvent(event);
    },
  };
}
