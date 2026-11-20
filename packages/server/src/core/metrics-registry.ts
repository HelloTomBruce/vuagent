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

/** 指标类型（本模块只用 counter/gauge 两类） */
type MetricKind = "counter" | "gauge";

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
};

/** 同一标签组的样本：labelPairs 已按键排序（渲染顺序），value 为当前值 */
interface MetricSample {
  labelPairs: Array<[string, string]>;
  value: number;
}

interface MetricFamily {
  kind: MetricKind;
  help: string;
  /** 标签组键（排序标签对的 JSON 串）→ 样本 */
  samples: Map<string, MetricSample>;
}

/** 标签值转义：Prometheus 文本格式要求 \\、"、\n 三种字符转义（先转反斜杠防二次转义） */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** HELP 文案转义：只需反斜杠与换行（双引号在 HELP 中合法） */
function escapeHelpText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

export class MetricsRegistry {
  /** 指标名 → 指标族（首次写入时建档） */
  private readonly families = new Map<string, MetricFamily>();

  /** 计数器累加（value 缺省 1；同标签组累计） */
  incCounter(name: string, labels?: Record<string, string>, value = 1): void {
    this.adjust(name, "counter", labels, (current) => current + value);
  }

  /** 仪表绝对置值（覆盖同标签组旧值） */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    this.adjust(name, "gauge", labels, () => value);
  }

  /**
   * 渲染 Prometheus 文本格式：每个指标族输出 # HELP / # TYPE 与全部样本行。
   * 族按名称排序、族内样本按标签组键排序、样本内标签按键字典序——输出完全确定。
   * 从未记录过的指标（无样本族）不输出，暴露面只含真实发生过的指标。
   */
  renderPrometheus(): string {
    const lines: string[] = [];
    for (const name of [...this.families.keys()].sort()) {
      const family = this.families.get(name)!;
      lines.push(`# HELP ${name} ${escapeHelpText(family.help)}`);
      lines.push(`# TYPE ${name} ${family.kind}`);
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
    family.samples.set(sampleKey, {
      labelPairs,
      value: mutate(existing ? existing.value : 0),
    });
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
