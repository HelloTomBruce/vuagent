/**
 * @vuagent/ui - Agent Component Registry
 * 全局 Agent UI 组件注册中心
 *
 * 注意：本模块刻意不携带任何顶层副作用（不在模块作用域调用 setupDefaultAgentRegistry），
 * 否则仅 import VaButton 的宿主也会被打入全部内置组件，tree-shaking 失效。
 * 由宿主或 runtime 显式初始化：useAgentChat() 内部会兜底调用 setupDefaultAgentRegistry()（幂等）。
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

/* ---------- propAdapter 入参守卫 ----------
 * args 来自大模型流式输出，必须视为不可信输入：可能为 null/非对象、字段类型错乱。
 * 这里统一做空值与类型兜底，避免裸取 args.xxx 导致渲染崩溃或透出脏值。 */
type RawArgs = Record<string, any> | null | undefined;

const asRecord = (v: RawArgs): Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const asBoolean = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const asEnum = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

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

let defaultsReady = false;

/**
 * 初始化并加载内置的核心 Agent-Ops 组件（幂等：重复调用不会重复注册）。
 */
export function setupDefaultAgentRegistry(): void {
  if (defaultsReady) return;
  defaultsReady = true;

  // 1. 审批卡片（危险操作最后闸门：安全语义收敛在组件内部——Enter/Esc 默认均为拒绝，
  //    这里刻意不透出模型 args 中的 approveShortcut，防止模型自行开启 Enter=批准）
  registerAgentComponent("ui_approval_card", {
    component: VaApprovalCard,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (rawArgs, ctx) => {
      const args = asRecord(rawArgs);
      const countdown = asNumber(args.countdown);
      return {
        title: asString(args.title) ?? (ctx.status === "streaming" ? "正在生成审批单..." : "审批申请"),
        detail: asString(args.detail),
        risk: asEnum(args.risk, ["low", "medium", "high"] as const),
        preview: asString(args.preview),
        confirmLabel: asString(args.confirmLabel),
        denyLabel: asString(args.denyLabel),
        countdown: ctx.status === "executing" ? countdown : 0,
        shortcuts: asBoolean(args.shortcuts) ?? (ctx.status === "executing"),
        // 绑定事件到 onSubmitAction 回调
        onApprove: () => {
          if (ctx.onSubmitAction && ctx.status === "executing") {
            ctx.onSubmitAction({ approved: true, reason: "manual" });
          }
        },
        onDeny: (reason?: unknown) => {
          if (ctx.onSubmitAction && ctx.status === "executing") {
            ctx.onSubmitAction({ approved: false, reason: asString(reason) ?? "manual" });
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
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        events: asArray(args.events),
        ledgerMaxHeight: asNumber(args.ledgerMaxHeight),
      };
    },
  });

  // 3. 代码对比
  registerAgentComponent("ui_code_diff", {
    component: VaCodeDiff,
    skeleton: CodeSkeleton,
    progressive: false, // Diff 需要代码段完整比对
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        oldText: asString(args.oldText) ?? "",
        newText: asString(args.newText) ?? "",
        fileName: asString(args.fileName),
        context: asNumber(args.context),
        wordLevel: asBoolean(args.wordLevel),
        defaultExpandAll: asBoolean(args.defaultExpandAll),
        maxHeight: asNumber(args.maxHeight),
        layout: asEnum(args.layout, ["unified", "side"] as const) ?? "unified",
      };
    },
  });

  // 4. 指标图表
  registerAgentComponent("ui_metric_chart", {
    component: VaMetricChart,
    skeleton: ChartSkeleton,
    progressive: false, // 待序列完整后呈现精美图表
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        title: asString(args.title) ?? "指标趋势",
        chartType: asEnum(args.chartType, ["line", "bar"] as const) ?? "bar",
        unit: asString(args.unit),
        series: asArray(args.series),
      };
    },
  });

  // 5. 任务计划
  registerAgentComponent("ui_agent_plan", {
    component: VaAgentPlan,
    skeleton: CardSkeleton,
    progressive: true, // 步骤随大模型输出渐进追加
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        title: asString(args.title) ?? "任务执行计划",
        steps: asArray(args.steps),
        editable: asBoolean(args.editable) ?? false,
      };
    },
  });

  // 6. 工作区文件树
  registerAgentComponent("ui_file_tree", {
    component: VaFileTree,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        title: asString(args.title) ?? "工作区文件树",
        tree: asArray(args.tree),
        defaultExpandDepth: asNumber(args.defaultExpandDepth) ?? 1,
        maxHeight: asNumber(args.maxHeight) ?? 360,
      };
    },
  });
}

export { registry as AgentUIRegistry, CardSkeleton, CodeSkeleton, ChartSkeleton };
