import type { SceneDef } from "./types";
import CloudOpsHost from "./cloudops/Host.vue";
import AnalysisHost from "./analysis/Host.vue";
import CodeHost from "./code/Host.vue";
import CopyHost from "./copy/Host.vue";
import TasksHost from "./tasks/Host.vue";

/**
 * 场景注册表：新增场景 = 在 scenes/ 下加目录（Host + 卡片），在此追加一条。
 * 卡片本身在 src/main.ts 全局注册，工具在 examples/server/src/tools/ 下实现。
 */
export const SCENES: SceneDef[] = [
  {
    id: "cloudops",
    label: "① 云运维 Copilot",
    tagline: "HITL 审批 + Generative UI：巡检出卡片，扩容先审批",
    greeting:
      "你好！这里是云运维场景。试试「巡检」看 Generative UI 卡片，或者点「扩容至 5 副本」体验高危操作的审批闭环：",
    chips: [
      { label: "🔍 巡检 order-service 状态", prompt: "请调用 ops_inspect_cluster 工具巡检 order-service 生产集群健康度并展示状态卡片" },
      { label: "⚡ 扩容至 5 副本（审批）", prompt: "请调用 ops_scale_replicas 工具紧急将 order-service 副本数扩容至 5 个以分流洪峰流量", tone: "action" },
    ],
    host: CloudOpsHost,
  },
  {
    id: "analysis",
    label: "② 数据分析副驾",
    tagline: "执行计划透明化：先出计划再出图",
    greeting:
      "你好！这里是数据分析场景。agent 会先把分析计划亮出来供你核对，执行后 KPI 趋势与渠道构成会以图表卡片呈现：",
    chips: [
      { label: "📊 制定 Q3 分析计划", prompt: "请调用 analysis_plan_create 工具为 Q3 销售复盘制定分析计划" },
      { label: "📈 直接跑分析出报告", prompt: "请调用 analysis_run_report 工具执行 2026-Q3 销售数据分析并生成报告", tone: "action" },
    ],
    host: AnalysisHost,
  },
  {
    id: "code",
    label: "③ 前端重构助手",
    tagline: "代码变更验收：文件树 + diff + 审批落盘 + 检查点",
    greeting:
      "你好！这里是代码重构场景。先生成只读重构预览（文件树 + 逐文件 diff），确认后「应用重构」会走审批并自动落检查点：",
    chips: [
      { label: "🧩 生成重构预览", prompt: "请调用 code_refactor_preview 工具，生成把 OrderService 拆分成领域子模块的重构预览" },
      { label: "🚀 应用重构（审批）", prompt: "请调用 code_refactor_apply 工具，将 OrderService 的重构预览写入仓库", tone: "action" },
    ],
    host: CodeHost,
  },
  {
    id: "copy",
    label: "④ 文案精修台",
    tagline: "行内逐词修订：改稿权在你手里",
    greeting:
      "你好！这里是文案精修场景。agent 的修改稿会以行内 diff 呈现，你可以逐词决定采纳或保留，全部决断后合成定稿：",
    chips: [
      {
        label: "✨ 精修发布文案",
        prompt:
          "请调用 copy_polish 工具，按「冲击力」风格精修这段文案：我们致力于打造行业领先的智能客服平台，通过非常强大的 AI 能力，为大家进行了全链路的服务体验提升和改进。平台支持多渠道接入，可以帮助您快速搭建属于自己的客服体系。",
      },
    ],
    host: CopyHost,
  },
  {
    id: "tasks",
    label: "⑤ 后台任务管家",
    tagline: "后台任务收件箱 + 终端实时日志流",
    greeting:
      "你好！这里是后台任务场景。耗时任务交给 agent 后台跑，收件箱统一管理状态，终端卡片实时跟踪日志：",
    chips: [
      { label: "🗂️ 启动历史数据回填", prompt: "请调用 task_start_backfill 工具，启动 orders_2025 历史订单数据回填任务集群" },
      { label: "📜 查看实时日志", prompt: "请调用 task_tail_log 工具，跟踪最新的回填任务实时日志", tone: "action" },
    ],
    host: TasksHost,
  },
];
