import type { SceneDef } from "./types";
import CloudOpsHost from "./cloudops/Host.vue";
import AnalysisHost from "./analysis/Host.vue";
import TasksHost from "./tasks/Host.vue";

/**
 * 场景注册表：新增场景 = 在 scenes/ 下加目录（Host + 卡片），在此追加一条。
 * 卡片本身在 src/main.ts 全局注册，工具在 examples/server/src/tools/ 下实现。
 * chips 里的 prompt 会点名工具，保证演示链路稳定命中。
 */
export const SCENES: SceneDef[] = [
  {
    id: "cloudops",
    label: "① 云运维 Copilot",
    tagline: "HITL 审批 + Generative UI：巡检 → 事件深挖 → 审批扩容",
    greeting:
      "你好！这里是云运维场景。巡检会返回趋势与 SLO 卡片，卡上的「一键建议扩容」可以直接驱动 agent 走审批；也可以先看看关联事件时间线：",
    chips: [
      { label: "🔍 全面体检（巡检+事件）", prompt: "请依次调用 ops_inspect_cluster 和 ops_list_incidents 工具，对 order-service 做一次全面体检并展示关联事件时间线" },
      { label: "⚡ 扩容至 5 副本（审批）", prompt: "请调用 ops_scale_replicas 工具紧急将 order-service 副本数扩容至 5 个以分流洪峰流量", tone: "action" },
      { label: "🚀 生产部署（表单→审批）", prompt: "开始部署 order-service", tone: "action" },
    ],
    host: CloudOpsHost,
  },
  {
    id: "analysis",
    label: "② 数据分析副驾",
    tagline: "计划先行 → 状态演进 → 图表报告 → 维度下钻",
    greeting:
      "你好！这里是数据分析场景。agent 会先制定计划、逐步执行（计划卡状态会从待执行变为全部完成），报告卡上还能点「下钻」继续深挖明细：",
    chips: [
      { label: "📊 计划→执行→报告（全链）", prompt: "请依次调用 analysis_plan_create、analysis_execute_plan 和 analysis_run_report 工具，为 2026-Q3 销售复盘制定计划、执行并生成完整报告", tone: "action" },
      { label: "🔎 按区域下钻明细", prompt: "请调用 analysis_drilldown 工具，按 region 维度下钻 Q3 销售明细" },
    ],
    host: AnalysisHost,
  },
  {
    id: "tasks",
    label: "③ 后台任务管家",
    tagline: "有状态仿真：进度与日志随真实时间演进",
    greeting:
      "你好！这里是后台任务场景。回填集群启动后会在后台真实推进——隔几秒再点「跟踪日志」，你会看到新内容和进度变化；出错的任务可以点「修复」看收件箱状态演进：",
    chips: [
      { label: "🗂️ 启动回填 + 跟踪日志", prompt: "请依次调用 task_start_backfill 工具启动 orders_2025 回填集群，再调用 task_tail_log 工具查看当前实时日志", tone: "action" },
      { label: "📜 再看一次日志", prompt: "请调用 task_tail_log 工具查看回填集群的最新日志与进度" },
      { label: "🛠️ 修复失败任务", prompt: "请调用 task_repair_failed 工具修复回填集群中失败的脏数据任务" },
    ],
    host: TasksHost,
  },
];
