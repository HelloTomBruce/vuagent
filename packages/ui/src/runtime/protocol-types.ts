/**
 * 内联自 @vuagent/protocol 的类型定义（vendored）。
 *
 * 为什么内联：@vuagent/ui 以 npm 包分发（dist 产物），运行时 JS 已将这些
 * 契约仅作类型使用（bundle 自包含，仅外部依赖 vue）；若保留对
 * @sinclair/typebox 的依赖声明，发布后宿主会解析到一个 npm 上不存在的
 * workspace 包，导致 `npm i @vuagent/ui` 直接失败。内联类型让发布包
 * 零外部依赖（peer 仅 vue），契约语义与 @vuagent/protocol 保持一致，
 * 两端类型演进时需人工同步（见 packages/protocol/src/lifecycle.ts / events.ts /
 * interaction.ts），同步由 scripts/check-protocol-sync.mjs 卡口机械把关。
 *
 * TASK-090：追加 vendor 交互契约类型（protocol/src/interaction.ts）——
 * 信封（UIActionEnvelope）与交互能力声明（UIComponentInteraction）。
 * 协议侧 ActionMeta/UIActionEnvelope 是 Static<typeof Schema> 计算类型，
 * 此处按 Schema 语义展开为字面声明（卡口对计算类型做名集合比对，
 * 形状保真由 protocol 侧 Schema 测试与本包信封快照测试双侧兜底）。
 */

/**
 * Agent 组件的四态生命周期：
 * 1. streaming: 大模型正在流式输出参数（可能是不完整 Partial 对象）
 * 2. executing: 参数已完整，正在后台执行或等待人工审批交互（挂起中）
 * 3. done: 执行完毕或审批已完成，呈现最终回执状态
 * 4. error: 执行失败或被超时拒绝
 */
export type AgentComponentStatus = "streaming" | "executing" | "done" | "error";

/**
 * 所有 Agent UI 组件的标准输入 Props 接口
 */
export interface AgentComponentBaseProps<TArgs = Record<string, any>, TResult = any> {
  toolCallId: string;
  componentName: string;
  status: AgentComponentStatus;
  args: Partial<TArgs>;
  result?: TResult;
  error?: string;
  /**
   * 交互类组件向服务端（或 ActionHub）提交决策或表单数据的回调
   */
  onSubmitAction?: (payload: any) => Promise<void> | void;
  /**
   * 是否只读模式（历史记录查看或禁用交互）
   */
  readonly?: boolean;
}

/**
 * 混排消息块结构（用于构建前端流式对话树）
 */
export type MessageBlock =
  | {
      id: string;
      kind: "text";
      content: string;
    }
  | {
      id: string;
      kind: "component";
      toolCallId: string;
      componentName: string;
      status: AgentComponentStatus;
      args: Record<string, any>;
      result?: any;
      error?: string;
    };

/**
 * 前端 UI 消费的归一化流式事件协议 (UIStreamEvent)
 */
export type UIStreamEvent =
  /**
   * 文本流式增量：助手普通的流式文字回复
   */
  | {
      type: "text_delta";
      messageId: string;
      delta: string;
    }
  /**
   * 组件生命周期开始：大模型发起某 UI 工具调用
   */
  | {
      type: "component_start";
      messageId: string;
      toolCallId: string;
      componentName: string;
    }
  /**
   * 组件参数流式增量：大模型吐出的半截 JSON 被服务端或前端容错解析出的局部 Props
   */
  | {
      type: "component_args_delta";
      toolCallId: string;
      partialArgs: Record<string, any>;
    }
  /**
   * 组件执行/交互就绪阶段：参数已生成完毕
   * 对于 HITL 交互类组件，此事件代表已进入等待人工交互的挂起态
   */
  | {
      type: "component_executing";
      toolCallId: string;
      componentName?: string;
      args: Record<string, any>;
    }
  /**
   * 组件完成态：工具执行完成或用户已提交人工交互，或发生错误
   */
  | {
      type: "component_ready";
      toolCallId: string;
      componentName?: string;
      status: "done" | "error";
      data?: any;
      error?: string;
    }
  /**
   * 本轮对话流式生成完毕
   */
  | {
      type: "turn_end";
    }
  /**
   * 对话或通道级异常
   */
  | {
      type: "error";
      code?: string;
      message: string;
    };

// ==========================================
// UI ↔ LLM 交互契约（vendored 自 protocol/src/interaction.ts，TASK-090）
// 信封在组件侧以类型化对象字面量构造；解析（parseUIActionPayload）只在 server 侧。
// ==========================================

/**
 * 协议侧为 @sinclair/typebox 的 TSchema（运行时校验只在 server 做）。
 * ui 侧不引入 typebox 运行时，仅以 JSON Schema 结构视角只读消费
 * （本地预校验见 runtime/interaction-validation.ts）——刻意保持宽松结构：
 * 回传值校验的权威永远在 server 边界（设计文档 §8「UI 回传不可信」）。
 * 非导出：仅为下方 vendored 声明提供同名标识符，不进发布类型面。
 */
type TSchema = Record<string, unknown>;

/** 交互元信息（对应 protocol ActionMetaSchema 的 Static 展开） */
export interface ActionMeta {
  /** 用户实际修改过的字段 key（区别于组件预填默认值） */
  editedFields?: string[];
  /** 用户交互耗时（毫秒） */
  durationMs?: number;
  /** 前端是否已过本地校验（服务端仍必须复核） */
  clientValidated?: boolean;
}

/** submit 信封：用户提交结构化值（values 形状由组件 resultSchema 约束） */
export interface UIActionSubmitEnvelope {
  kind: "submit";
  values: Record<string, unknown>;
  meta?: ActionMeta;
}

/**
 * cancel 信封：用户主动取消——一等公民而非错误
 * （设计文档 §3：混为 error 会诱导模型重试轰炸）
 */
export interface UIActionCancelEnvelope {
  kind: "cancel";
  reason?: string;
  meta?: ActionMeta;
}

/** patch 信封：L3 预留的增量编辑，不终结挂起（运行时本阶段不实现） */
export interface UIActionPatchEnvelope {
  kind: "patch";
  values: Record<string, unknown>;
  meta?: ActionMeta;
}

/** 回传信封判别联合（对应 protocol UIActionEnvelopeSchema 的 Static 展开） */
export type UIActionEnvelope =
  | UIActionSubmitEnvelope
  | UIActionCancelEnvelope
  | UIActionPatchEnvelope;

export type UIActionKind = UIActionEnvelope["kind"];

/**
 * 交互能力分级（设计文档 §2）：
 * - L0 presentational：纯展示，无回传通道（缺省等级）；
 * - L1 decision：有限决策集（approve/deny），枚举型 payload；
 * - L2 form：结构化值采集——必须声明 resultSchema；
 * - L3 collaborative：多次增量 patch，终态由显式 submit/cancel 触发——必须声明 resultSchema。
 */
export type UIInteractionLevel = "L0" | "L1" | "L2" | "L3";

/**
 * 组件交互声明（挂在 RegisteredComponentEntry.interaction）。
 *
 * 刻意用 TS interface 而非 TypeBox Schema：resultSchema 本身是 TSchema
 * （schema 的 schema 在 TypeBox 里只能退化为 Unknown，失去校验意义），
 * 且该声明是定义期契约，不是线格式。
 */
export interface UIComponentInteraction {
  level: UIInteractionLevel;
  /**
   * UI → LLM 方向的回传值 Schema（L2/L3 必填，或与 deriveResultSchema 二选一）：
   * 一身三任——服务端边界校验规则 / 模型词汇表（字段 description）/ 摘要生成模板。
   */
  resultSchema?: TSchema;
  /**
   * args 驱动的 resultSchema 派生器（TASK-092，与 resultSchema 二选一）：
   * resultSchema 不允许模型自行声明（设计文档 §7——模型给的 fields 是输入，
   * resultSchema 是推导结果，防止模型通过自定义 resultSchema 放宽校验），
   * ui_form 这类「Schema 由模型入参决定」的组件通过本回调在服务端/前端
   * 按同一份 fields 推导（派生逻辑本体见 form.ts deriveFormResultSchema）。
   * 定义期合法性由 assertValidInteraction() 把关（L2/L3 两者至少其一）。
   */
  deriveResultSchema?: (args: Record<string, unknown>) => TSchema;
  /**
   * 挂起超时的语义归属：deny（L1 缺省，视为拒绝）/ cancel（L2 缺省，视为放弃）。
   * 超时不允许映射为 submit（半成品值不得当作用户意图，设计文档 §6）。
   */
  timeoutMeaning?: "cancel" | "deny";
}
