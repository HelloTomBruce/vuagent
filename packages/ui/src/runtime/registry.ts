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
import { VaTaskBoard } from "../components/task-board/index.js";
import { VaChangeSummary } from "../components/change-summary/index.js";
import { VaCommentThread } from "../components/comment-thread/index.js";
import { VaAiAnswer } from "../components/ai-answer/index.js";
import { VaForm } from "../components/form/index.js";
import type { FormFieldItem } from "../components/form/index.js";
import type { PlanStep } from "../components/agent-plan/index.js";
import { deriveFormResultSchema } from "./form-result-schema.js";
import { formFieldErrors } from "./form-errors.js";
import { getPlanStepsMirror, setPlanStepsMirror, clearPlanStepsMirror } from "./plan-steps-mirror.js";
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
  //    TASK-090：声明 L1 交互等级；回传一律走信封（设计文档 §3）——
  //    approve/deny 都是 submit 的 values 形态（deny 不是 cancel；
  //    cancel 留给「关闭/放弃」语义，审批卡无此出口；超时的权威裁决在 server，
  //    客户端倒计时触发的 deny 以 note 携带 "timeout" 供摘要展示）。
  registerAgentComponent("ui_approval_card", {
    component: VaApprovalCard,
    skeleton: CardSkeleton,
    progressive: true,
    interaction: { level: "L1" },
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
        // 绑定事件到 onSubmitAction 回调（产出信封；ctx.status 自查保留为双保险，
        // 第一道防线是 VaAgentRenderer 渲染层守卫：非 executing 态只透传 no-op）
        onApprove: () => {
          if (ctx.onSubmitAction && ctx.status === "executing") {
            ctx.onSubmitAction({
              kind: "submit",
              values: { approved: true },
              meta: { editedFields: [] },
            });
          }
        },
        onDeny: (reason?: unknown) => {
          if (ctx.onSubmitAction && ctx.status === "executing") {
            ctx.onSubmitAction({
              kind: "submit",
              values: { approved: false, note: asString(reason) ?? "manual" },
              meta: { editedFields: [] },
            });
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

  // 5. 任务计划（Phase 3：L3 协作回传落地，设计文档 §2/§3）
  // 步骤同样视为不可信输入：逐项类型守卫收敛后才渲染/回传（脏项丢弃，
  // 同 ui_form sanitizeFormFields 先例）。协作模式下四条回传通道：
  // - update:steps → patch 信封（values.steps 为规范化后的完整步骤数组，增量不终结挂起）
  // - retry        → submit 信封（values.retryStepId，终态：唤醒模型执行该步骤重试）
  // - confirm      → submit 信封（values:{}，终态：server 合并此前 patch 暂存的 steps 落账）
  // - cancel       → cancel 信封（终态：用户放弃计划，一等公民而非错误）
  const PLAN_STEP_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "done", "error"]);
  const sanitizePlanStep = (item: unknown): PlanStep | null => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) return null;
    if (typeof r.title !== "string" || !r.title) return null;
    const step: PlanStep = { id: r.id, title: r.title };
    if (typeof r.detail === "string") step.detail = r.detail;
    if (typeof r.status === "string" && PLAN_STEP_STATUSES.has(r.status)) {
      step.status = r.status as PlanStep["status"];
    }
    if (typeof r.startedAt === "number" && Number.isFinite(r.startedAt)) step.startedAt = r.startedAt;
    if (typeof r.duration === "number" && Number.isFinite(r.duration)) step.duration = r.duration;
    return step;
  };
  const sanitizePlanSteps = (raw: unknown): PlanStep[] => {
    if (!Array.isArray(raw)) return [];
    const steps: PlanStep[] = [];
    for (const item of raw) {
      const step = sanitizePlanStep(item);
      if (step) steps.push(step);
    }
    return steps;
  };

  registerAgentComponent("ui_agent_plan", {
    component: VaAgentPlan,
    skeleton: CardSkeleton,
    progressive: true, // 步骤随大模型输出渐进追加
    interaction: {
      level: "L3",
      timeoutMeaning: "cancel",
      // L3 结果形状是静态的（patch=steps / submit=retryStepId 或空确认），
      // 与 server 侧 PlanCollabResultSchema 语义一致——静态字面量供本地预校验
      // （interaction-validation）与摘要词汇表使用；权威校验仍在 server 边界（§8）。
      resultSchema: {
        type: "object",
        properties: {
          steps: { type: "array", description: "用户编辑后的完整计划步骤数组（patch 增量回传）" },
          retryStepId: { type: "string", description: "用户要求重试的失败步骤 id（submit 终态）" },
        },
      },
    },
    propAdapter: (rawArgs, ctx) => {
      const args = asRecord(rawArgs);
      // 协作编辑累积（评审 R1 修复）：渲染输入优先取「最近一次已发送的 steps」
      // 镜像——否则纯 props 驱动的组件每次编辑都从原始 args 计算，前一次 patch
      // 的增量被静默覆盖（连续编辑丢失数据 + UI 回弹旧值）。终态发射时清理镜像。
      const base = {
        title: asString(args.title) ?? "任务执行计划",
        steps: sanitizePlanSteps(getPlanStepsMirror(ctx.toolCallId) ?? args.steps),
        editable: asBoolean(args.editable) ?? false,
      };
      // 缺省形态（模型未显式 collaborative=true 或非挂起态）：
      // 不透出任何协作 prop——视觉/行为与既有渲染零变化。
      if (args.collaborative !== true || ctx.status !== "executing") return base;
      // 协作形态（挂起等待人工）：透传协作开关 + 四条回传通道。
      // 所有发射前再自查 ctx.status === "executing"（渲染层 no-op 桩守卫之外的双保险）。
      return {
        ...base,
        collaborative: true,
        disabled: ctx.status !== "executing",
        // L3 patch/submit 被 server 422 拒绝的 fieldErrors 就地回显
        // （§4.2 重填闭环，复用 form-errors 响应式通道；propAdapter 在
        // activeProps computed 内执行，读取即注册响应依赖）
        fieldErrors: formFieldErrors.get(ctx.toolCallId),
        "onUpdate:steps": (steps: unknown) => {
          if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
          const clean = sanitizePlanSteps(steps);
          // 先更新镜像再发射：propAdapter 读取镜像驱动回显，用户编辑不回弹
          setPlanStepsMirror(ctx.toolCallId, clean);
          void ctx.onSubmitAction({
            kind: "patch",
            // 增量不终结挂起：回传完整步骤数组（逐项收敛，脏数据丢弃）
            values: { steps: clean },
            meta: { editedFields: ["steps"] },
          });
        },
        onRetry: (step: unknown) => {
          if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
          const retryStepId =
            step !== null && typeof step === "object"
              ? asString((step as Record<string, unknown>).id)
              : undefined;
          if (!retryStepId) return; // 脏步骤（无合法 id）不发射
          clearPlanStepsMirror(ctx.toolCallId); // 终态：合并基准以落账为准
          // 终态：唤醒模型执行重试
          void ctx.onSubmitAction({
            kind: "submit",
            values: { retryStepId },
            meta: { editedFields: ["retryStepId"] },
          });
        },
        onConfirm: () => {
          if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
          clearPlanStepsMirror(ctx.toolCallId); // 终态：合并基准以落账为准
          // 终态空 values：server 会把此前 patch 暂存的 steps 合并进落账
          void ctx.onSubmitAction({ kind: "submit", values: {}, meta: { editedFields: [] } });
        },
        onCancel: () => {
          if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
          clearPlanStepsMirror(ctx.toolCallId); // 终态：放弃协作编辑
          void ctx.onSubmitAction({ kind: "cancel" });
        },
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

  // 7. 任务看板（agent 任务拆解/分工/状态流转）
  registerAgentComponent("ui_task_board", {
    component: VaTaskBoard,
    skeleton: CardSkeleton,
    progressive: true, // 列与任务随模型输出渐进追加
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        columns: asArray(args.columns),
        tasks: asArray(args.tasks),
      };
    },
  });

  // 8. 变更摘要（一轮工作收尾的 N 文件 +adds −dels 台账）
  registerAgentComponent("ui_change_summary", {
    component: VaChangeSummary,
    skeleton: CardSkeleton,
    progressive: false, // 文件清单齐备后一次性呈现
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        title: asString(args.title),
        files: asArray(args.files),
        duration: asNumber(args.duration),
        toolCalls: asNumber(args.toolCalls),
        finishedAt: asNumber(args.finishedAt),
      };
    },
  });

  // 9. 评论线程（契约卡为持久化记录：关闭输入框，不做无后端的"发布"假交互）
  registerAgentComponent("ui_comment_thread", {
    component: VaCommentThread,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (rawArgs) => {
      const args = asRecord(rawArgs);
      return {
        comments: asArray(args.comments),
        maxHeight: asNumber(args.maxHeight) ?? 360,
        composer: false,
      };
    },
  });

  // 10. 引用回答（正文 [n] 角标 + 来源列表；流式阶段带光标）
  registerAgentComponent("ui_ai_answer", {
    component: VaAiAnswer,
    skeleton: CardSkeleton,
    progressive: true,
    propAdapter: (rawArgs, ctx) => {
      const args = asRecord(rawArgs);
      return {
        question: asString(args.question),
        answer: asString(args.answer) ?? "",
        sources: asArray(args.sources),
        streaming: ctx.status === "streaming",
      };
    },
  });

  // 11. 表单（TASK-092，首个 L2 值采集组件；设计文档 §7）
  // resultSchema 不允许模型自行声明——由 deriveResultSchema 按挂起 args.fields
  // 派生（deriveFormResultSchema vendored 副本，与 protocol 逐字同步，
  // check-protocol-sync 函数级语料锁死）。本地预校验（useAgentChat）与
  // server 边界校验（validateEnvelopeValues）共用同一推导口径。
  // 渲染字段同样视为不可信输入：逐字段类型守卫收敛后才交给 VaForm。
  const FORM_FIELD_TYPES: ReadonlySet<string> = new Set([
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
    "date",
  ]);
  const sanitizeFormFields = (raw: unknown): FormFieldItem[] => {
    if (!Array.isArray(raw)) return [];
    const fields: FormFieldItem[] = [];
    for (const item of raw) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      if (typeof r.key !== "string" || !r.key) continue;
      // 保留键防御（评审 N-12，与 protocol coerceFormFields 同口径）
      if (/^(?:__proto__|constructor|prototype)$/.test(r.key)) continue;
      if (typeof r.label !== "string" || !r.label) continue;
      if (typeof r.type !== "string" || !FORM_FIELD_TYPES.has(r.type)) continue;
      const field: FormFieldItem = {
        key: r.key,
        label: r.label,
        type: r.type as FormFieldItem["type"],
      };
      if (typeof r.description === "string") field.description = r.description;
      if (typeof r.placeholder === "string") field.placeholder = r.placeholder;
      if (typeof r.unit === "string") field.unit = r.unit;
      if (r.required === true) field.required = true;
      if (r.secret === true) field.secret = true;
      if ("default" in r) field.default = r.default;
      if (Array.isArray(r.options)) {
        const options = r.options
          .filter(
            (o): o is { value: string; label: string } =>
              o !== null && typeof o === "object" &&
              typeof (o as Record<string, unknown>).value === "string" &&
              typeof (o as Record<string, unknown>).label === "string"
          )
          .map((o) => ({ value: o.value, label: o.label }));
        if (options.length > 0) field.options = options;
      }
      fields.push(field);
    }
    // 上限收紧（与 FormToolSchema.fields.maxItems 同口径）
    return fields.slice(0, 32);
  };

  registerAgentComponent("ui_form", {
    component: VaForm,
    skeleton: CardSkeleton,
    progressive: true,
    interaction: {
      level: "L2",
      // resultSchema 由 fields 派生（args 到达时才有形状）——server 侧
      // resolveInteractionResultSchema 与 ui 本地预校验同走 deriveResultSchema
      deriveResultSchema: (args) => deriveFormResultSchema(sanitizeFormFields(asRecord(args).fields)),
    },
    propAdapter: (rawArgs, ctx) => {
      const args = asRecord(rawArgs);
      return {
        title: asString(args.title) ?? (ctx.status === "streaming" ? "正在生成表单..." : "表单"),
        description: asString(args.description),
        fields: sanitizeFormFields(args.fields),
        submitLabel: asString(args.submitLabel) ?? "提交",
        disabled: ctx.status !== "executing",
        // server 422 / 本地预校验的逐字段错误就地回显（form-errors 响应式通道）
        fieldErrors: formFieldErrors.get(ctx.toolCallId),
        onSubmit: async (values: Record<string, unknown>, editedFields: string[]) => {
          if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
          // clientValidated 由 useAgentChat 本地预校验通过后自动补记（TASK-090）
          await ctx.onSubmitAction({ kind: "submit", values, meta: { editedFields } });
        },
        onCancel: () => {
          if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
          void ctx.onSubmitAction({ kind: "cancel" });
        },
      };
    },
  });
}

export { registry as AgentUIRegistry, CardSkeleton, CodeSkeleton, ChartSkeleton };
