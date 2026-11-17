/**
 * @vuagent/ui - Agent Component Registry
 * 全局 Agent UI 组件注册中心
 */

import type { RegisteredComponentEntry } from "./types.js";
import { VaApprovalCard } from "../components/approval-card/index.js";
import { VaTrajectory } from "../components/trajectory/index.js";
import { VaCodeDiff } from "../components/code-diff/index.js";
import { VaAgentPlan } from "../components/agent-plan/index.js";
import { VaMetricChart } from "../components/metric-chart/index.js";
import { VaFileTree } from "../components/file-tree/index.js";
import CardSkeleton from "./skeletons/CardSkeleton.vue";
import CodeSkeleton from "./skeletons/CodeSkeleton.vue";
import ChartSkeleton from "./skeletons/ChartSkeleton.vue";

const registry = new Map<string, RegisteredComponentEntry>();

/**
 * 注册一个 Agent UI 组件
 */
export function registerAgentComponent(name: string, entry: RegisteredComponentEntry): void {
  registry.set(name, entry);
}

/**
 * 注销组件
 */
export function unregisterAgentComponent(name: string): boolean {
  return registry.delete(name);
}

/**
 * 获取注册项
 */
export function getAgentComponent(name: string): RegisteredComponentEntry | undefined {
  return registry.get(name);
}

/**
 * 初始化并加载内置的核心 Agent-Ops 组件
 */
export function setupDefaultAgentRegistry(): void {
  // 1. 审批卡片
  registerAgentComponent("ui_approval_card", {
    component: VaApprovalCard,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (args, ctx) => {
      return {
        title: args.title ?? (ctx.status === "streaming" ? "正在生成审批单..." : "审批申请"),
        detail: args.detail,
        risk: args.risk,
        preview: args.preview,
        confirmLabel: args.confirmLabel,
        denyLabel: args.denyLabel,
        countdown: ctx.status === "executing" ? args.countdown : 0,
        shortcuts: args.shortcuts ?? (ctx.status === "executing"),
        // 绑定事件到 onSubmitAction 回调
        onApprove: () => {
          if (ctx.onSubmitAction && ctx.status === "executing") {
            ctx.onSubmitAction({ approved: true, reason: "manual" });
          }
        },
        onDeny: (reason?: string) => {
          if (ctx.onSubmitAction && ctx.status === "executing") {
            ctx.onSubmitAction({ approved: false, reason: reason ?? "manual" });
          }
        },
      };
    },
  });

  // 2. 轨迹流与时间线台账
  registerAgentComponent("ui_trajectory", {
    component: VaTrajectory,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (args) => {
      return {
        events: Array.isArray(args.events) ? args.events : [],
        ledgerMaxHeight: args.ledgerMaxHeight,
      };
    },
  });

  // 3. 代码对比
  registerAgentComponent("ui_code_diff", {
    component: VaCodeDiff,
    skeleton: CodeSkeleton,
    progressive: false, // Diff 需要代码段完整比对
    propAdapter: (args) => {
      return {
        oldText: args.oldText ?? "",
        newText: args.newText ?? "",
        fileName: args.fileName,
        context: args.context,
        wordLevel: args.wordLevel,
        defaultExpandAll: args.defaultExpandAll,
        maxHeight: args.maxHeight,
        layout: args.layout ?? "unified",
      };
    },
  });

  // 4. 指标图表
  registerAgentComponent("ui_metric_chart", {
    component: VaMetricChart,
    skeleton: ChartSkeleton,
    progressive: false, // 待序列完整后呈现精美图表
    propAdapter: (args) => {
      return {
        title: args.title ?? "指标趋势",
        chartType: args.chartType ?? "bar",
        unit: args.unit,
        series: Array.isArray(args.series) ? args.series : [],
      };
    },
  });

  // 5. 任务计划
  registerAgentComponent("ui_agent_plan", {
    component: VaAgentPlan,
    skeleton: CardSkeleton,
    progressive: true, // 步骤随大模型输出渐进追加
    propAdapter: (args) => {
      return {
        title: args.title ?? "任务执行计划",
        steps: Array.isArray(args.steps) ? args.steps : [],
        editable: args.editable ?? false,
      };
    },
  });

  // 6. 工作区文件树
  registerAgentComponent("ui_file_tree", {
    component: VaFileTree,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (args) => {
      return {
        title: args.title ?? "工作区文件树",
        tree: Array.isArray(args.tree) ? args.tree : [],
        defaultExpandDepth: args.defaultExpandDepth ?? 1,
        maxHeight: args.maxHeight ?? 360,
      };
    },
  });
}

// 默认初始化预设
setupDefaultAgentRegistry();

export { registry as AgentUIRegistry, CardSkeleton, CodeSkeleton, ChartSkeleton };
