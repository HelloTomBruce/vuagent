import type { SceneDef } from "./types";
import CloudOpsHost from "./cloudops/Host.vue";
import AnalysisHost from "./analysis/Host.vue";
import CodeHost from "./code/Host.vue";
import CopyHost from "./copy/Host.vue";
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
    id: "code",
    label: "③ 前端重构助手",
    tagline: "diff 预览 → 测试验证 → 审批落盘 → 检查点回滚",
    greeting:
      "你好！这里是代码重构场景。完整链路：生成只读重构预览 → 跑验证测试（失败会自动修复重跑）→ 应用重构走审批 → 自动落检查点，检查点行上可以直接预览 diff 或触发回滚：",
    chips: [
      { label: "🧩 生成重构预览", prompt: "请调用 code_refactor_preview 工具，生成把 OrderService 拆分成领域子模块的重构预览" },
      { label: "🧪 跑重构验证测试", prompt: "请调用 code_run_tests 工具，对重构后的 OrderService 模块运行验证测试" },
      { label: "🚀 应用重构（审批）", prompt: "请调用 code_refactor_apply 工具，将 OrderService 的重构预览写入仓库", tone: "action" },
    ],
    host: CodeHost,
  },
  {
    id: "copy",
    label: "④ 文案精修台",
    tagline: "三种风格变体 → 点选精修 → 行内逐词采纳",
    greeting:
      "你好！这里是文案精修场景。可以让 agent 先出三种风格变体，点选任一变体后会生成可逐词采纳的精修 diff——改稿权始终在你手里：",
    chips: [
      { label: "🎭 生成三种风格变体", prompt: "请调用 copy_variants 工具，为这段产品发布文案生成三种风格变体：我们致力于打造行业领先的智能客服平台，通过非常强大的 AI 能力，为大家进行了全链路的服务体验提升和改进。" },
      { label: "✨ 直接按冲击力精修", prompt: "请调用 copy_polish 工具，按「冲击力」风格精修这段文案：我们致力于打造行业领先的智能客服平台，通过非常强大的 AI 能力，为大家进行了全链路的服务体验提升和改进。平台支持多渠道接入，可以帮助您快速搭建属于自己的客服体系。" },
    ],
    host: CopyHost,
  },
  {
    id: "tasks",
    label: "⑤ 后台任务管家",
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
