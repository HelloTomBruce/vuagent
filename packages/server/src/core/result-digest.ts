/**
 * TASK-089（实施方案 TASK-B）：UI 交互结果的语义摘要生成器（纯函数）。
 *
 * 设计文档 docs/design/ui-llm-interaction-contract.md §4（双层工具结果）：
 * tool 消息 content = 语义摘要（自然语言段）+ 结构化附录（```json 段）——
 * 摘要供模型理解，附录供精确引用，两者数值同源（附录直接来自校验输出，不做二次加工）。
 *
 * §4.1 规则表全部由 resultSchema 的字段 description 驱动生成（词汇表/校验规则/摘要模板
 * 一身三任），本模块是泛型生成器，不逐组件特判：
 * | 字段类型   | 摘要形态                                        |
 * | string/number | {description}: {value}{unit?}              |
 * | boolean    | {description}: 是 / 否                            |
 * | enum       | 值回映到 option 的 label（literal 的 description/label）|
 * | 缺省未填   | {description}: （用户未填写）                      |
 * | secret:true| 打码——值不进摘要也不进附录（不依赖调用方自觉）      |
 * | 数组/嵌套  | 短则内联，长/深则折叠计数「N 项（详见附录）」        |
 *
 * 注入面约束（§8）：单字段渲染值 ≤500 字符、附录 JSON ≤4KB（常量在 action-envelope.ts）。
 */

import type { TSchema } from "@sinclair/typebox";
import type {
  UIActionEnvelope,
  UIComponentInteraction,
} from "@vuagent/protocol";
import {
  DIGEST_MAX_APPENDIX_CHARS,
  truncateFieldText,
} from "./action-envelope.js";

/** 数组/对象内联展示的字符上限（超出折叠为计数形态） */
const INLINE_COMPACT_MAX_CHARS = 80;

// ==========================================
// 1. 字段词汇表与取值渲染（§4.1 规则表）
// ==========================================

type SchemaNode = TSchema & {
  description?: string;
  label?: string;
  unit?: string;
  secret?: boolean;
  const?: unknown;
  enum?: unknown[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  type?: string;
};

/** 字段显示名：resultSchema 字段 description 优先，缺省回退 key */
function fieldLabel(key: string, schema: SchemaNode | undefined): string {
  const desc = typeof schema?.description === "string" ? schema.description.trim() : "";
  return desc || key;
}

/** 是否为「用户未填写」：undefined / null / 空串统一视为未填 */
function isUnfilled(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** secret 值打码：字符串保留前 3 字符（对齐设计文档示例 sk-…****），其余形态全码 */
export function maskSecretValue(value: unknown): string {
  if (typeof value === "string" && value.length > 3) {
    return `${value.slice(0, 3)}…****`;
  }
  return "****";
}

/**
 * TASK-092：secret 占位形态（{ ref, masked }，见 core/secret-store.ts）。
 * 路由边界剥离后，envelope.values 中的 secret 字段已是占位对象——
 * 摘要/附录直接复用占位里的 masked（不重复打码、不触达 ref 指向的明文）。
 */
export function isSecretPlaceholder(
  value: unknown
): value is { ref: string; masked: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).ref === "string" &&
    typeof (value as Record<string, unknown>).masked === "string"
  );
}

/** enum 值回映 label：literal 的 label/description 优先，缺省回退原始值 */
function enumLabelOf(schema: SchemaNode | undefined, value: unknown): string | undefined {
  if (!schema) return undefined;
  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  for (const option of candidates) {
    if (option && typeof option === "object" && "const" in option && option.const === value) {
      const label =
        (typeof option.label === "string" && option.label) ||
        (typeof option.description === "string" && option.description) ||
        undefined;
      return label ?? String(value);
    }
  }
  if (Array.isArray(schema.enum) && schema.enum.some((v) => v === value)) {
    return String(value);
  }
  if ("const" in schema && schema.const === value) {
    return String(value);
  }
  return undefined;
}

const isScalar = (v: unknown): v is string | number | boolean | null =>
  v === null || ["string", "number", "boolean"].includes(typeof v);

/** 标量渲染（boolean 是/否、number/string 原样、unit 后缀、enum label 回映） */
function renderScalar(schema: SchemaNode | undefined, value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  const enumLabel = enumLabelOf(schema, value);
  if (enumLabel !== undefined && typeof value === "string") return enumLabel;
  const unit = typeof schema?.unit === "string" && schema.unit ? ` ${schema.unit}` : "";
  return `${String(value)}${unit}`;
}

/** 单字段渲染：数组/嵌套短则内联、长则折叠计数（深度 >2 不再展开） */
function renderValue(schema: SchemaNode | undefined, value: unknown, depth: number): string {
  if (isScalar(value)) return renderScalar(schema, value);
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      const inline = value.map((v) => renderScalar(undefined, v)).join("、");
      if (inline.length > 0 && inline.length <= INLINE_COMPACT_MAX_CHARS) return inline;
    }
    return `${value.length} 项（详见附录）`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (depth < 2) {
      const compact = JSON.stringify(record);
      if (compact.length <= INLINE_COMPACT_MAX_CHARS) return compact;
    }
    return `${keys.length} 个字段（详见附录）`;
  }
  return String(value);
}

/** 渲染单个字段行（secret 打码 / 未填标注 / 截断在此收口） */
function renderFieldLine(
  key: string,
  schema: SchemaNode | undefined,
  values: Record<string, unknown>
): string {
  const label = fieldLabel(key, schema);
  const value = values[key];
  if (schema?.secret === true) {
    // §5 敏感值通道：摘要只证明「已提供」，明文永不进上下文
    if (isSecretPlaceholder(value)) return `- ${label}: 已提供（${value.masked}）`;
    return `- ${label}: ${isUnfilled(value) ? "（用户未填写）" : `已提供（${maskSecretValue(value)}）`}`;
  }
  if (isUnfilled(value)) return `- ${label}: （用户未填写）`;
  return `- ${label}: ${truncateFieldText(renderValue(schema, value, 0))}`;
}

// ==========================================
// 2. 摘要生成（submit / cancel / timeout 三形态）
// ==========================================

export interface SubmitDigestInput {
  /** 组件标题（进入「用户在「…」中…」模板） */
  title: string;
  values: Record<string, unknown>;
  /** L2/L3 的 resultSchema：词汇表（字段 description / enum label / unit / secret 标记） */
  resultSchema?: TSchema;
  /** meta.editedFields：区分「用户确认过」与「默认值透传」的尾句数据源 */
  editedFields?: string[];
}

/**
 * submit 摘要（§4.1 模板）：
 * 用户在「{title}」中提交了以下信息：
 * - 字段: 值
 * （editedFields 尾句：用户亲自修改 / 默认值透传）
 */
export function digestSubmit(input: SubmitDigestInput): string {
  const properties = (input.resultSchema as SchemaNode | undefined)?.properties ?? {};
  const lines: string[] = [];
  const seen = new Set<string>();

  // resultSchema 声明的字段按 Schema 顺序输出（词汇表驱动）
  for (const key of Object.keys(properties)) {
    seen.add(key);
    lines.push(renderFieldLine(key, properties[key], input.values));
  }
  // Schema 之外的额外键（兼容非严格 Schema 容忍的多余 values）按原样 key 输出
  for (const key of Object.keys(input.values)) {
    if (seen.has(key)) continue;
    lines.push(renderFieldLine(key, undefined, input.values));
  }

  const body =
    lines.length > 0
      ? lines.join("\n")
      : "- （用户未提交任何字段）";

  let digest = `用户在「${input.title}」中提交了以下信息：\n${body}`;

  // editedFields 尾句——区分「用户确认」与「默认值透传」（表单场景最重要的意图信号）
  if (input.editedFields !== undefined) {
    if (input.editedFields.length > 0) {
      const labels = input.editedFields.map((key) => fieldLabel(key, properties[key]));
      digest += `\n\n其中「${labels.join("」、「")}」为用户亲自修改，其余沿用了你提供的默认值。`;
    } else {
      digest += `\n\n用户未修改任何预填值，直接确认提交（所有字段均为默认值透传）。`;
    }
  }
  return digest;
}

/** cancel 摘要：取消是一等公民而非错误（§3——混为 error 会诱导模型重试轰炸） */
export function digestCancel(input: { title: string; reason?: string }): string {
  const reason = input.reason?.trim();
  return (
    `用户在「${input.title}」中取消了本次交互${reason ? `（原因：${reason}）` : ""}。` +
    `这是用户的主动决定（非系统错误）——请不要自动重试或重复发起同一交互；` +
    `可询问用户意图，或改用其他方式继续。`
  );
}

/**
 * timeout 摘要：超时由服务端裁决生成（不进信封），语义归属取 interaction.timeoutMeaning
 * （L1 缺省 deny / L2 缺省 cancel）。
 */
export function digestTimeout(input: {
  title: string;
  meaning: "cancel" | "deny";
  timeoutMs?: number;
}): string {
  const waited = input.timeoutMs ? `（等待约 ${Math.round(input.timeoutMs / 1000)} 秒无响应）` : "";
  const semantics = input.meaning === "deny" ? "按「拒绝」处理" : "按「用户放弃」处理";
  return (
    `「${input.title}」等待用户响应超时${waited}，${semantics}。` +
    `这不是系统错误——请不要自动重试同一交互，可在用户在场时再次发起，或改用其他方式继续。`
  );
}

// ==========================================
// 3. L1 审批决策摘要（信封迁移：驳回不再是 Error 消息）
// ==========================================

export interface ApprovalDigestInput {
  /** 被审批的工具名（审批卡标题锚点） */
  toolName: string;
  /** 路由边界解析出的信封（旧客户端经兼容映射为 submit；超时/中止无信封） */
  envelope?: UIActionEnvelope;
  reason?: string;
  note?: string;
  timeoutMs?: number;
}

/** L1 批准摘要（approved 路径的模型可见文本） */
export function digestApprovalGranted(input: ApprovalDigestInput): string {
  const note = input.note?.trim();
  return `用户在审批中批准了「${input.toolName}」的执行请求${note ? `（备注：${note}）` : ""}。`;
}

/**
 * L1 驳回/取消/超时摘要（cancel/deny 语义——正常结果 isError=false）：
 * 从旧的 `Error: 操作被用户驳回...` 迁移而来（TASK-089 预期行为变更）。
 */
export function digestApprovalDecision(input: ApprovalDigestInput): string {
  const note = input.note?.trim();
  // cancel 信封：用户关闭/放弃审批（非拒绝、非批准）
  if (input.envelope?.kind === "cancel") {
    const cancelReason = input.envelope.reason?.trim() || note;
    return (
      `用户在审批中取消了对「${input.toolName}」的决策（关闭了审批界面）` +
      `${cancelReason ? `（原因：${cancelReason}）` : ""}。` +
      `这不代表批准，也不是系统错误——不要假定用户意图，可与用户确认后再决定下一步。`
    );
  }
  if (input.reason === "timeout") {
    return digestTimeout({ title: `执行「${input.toolName}」的审批`, meaning: "deny", timeoutMs: input.timeoutMs });
  }
  if (input.reason === "aborted") {
    return (
      `「${input.toolName}」的审批已被中止${note ? `（${note}）` : ""}。` +
      `这不是系统错误——请按当前会话状态决定是否需要收尾说明。`
    );
  }
  // 人工驳回（submit values.approved=false / 旧形态 approved:false）
  // TASK-091：文案 note 优先、reason 兜底——新旧客户端键位不同（信封 values.note /
  // 旧形态顶层 reason），路由层已归一回填，此处兜底防直接 ActionHub 注入路径漏键。
  const denyNote = note || input.reason?.trim();
  return (
    `用户驳回了「${input.toolName}」的执行请求${denyNote ? `（原因：${denyNote}）` : ""}。` +
    `这是用户的明确决定而非系统错误——不要换汤不换药地重试同一操作；` +
    `如需继续，请改用其他方案或与用户确认。`
  );
}

// ==========================================
// 4. 结构化附录（```json 段）与双层组装
// ==========================================

/** 附录取值：secret 字段递归打码（值不进附录——不依赖调用方自觉） */
function maskForAppendix(
  value: unknown,
  schema: SchemaNode | undefined,
  depth: number
): unknown {
  if (schema?.secret === true && value !== undefined) {
    // TASK-092：占位形态保留 { ref, masked }——模型据此在后续工具调用中
    // 以 ref 引用该敏感值（设计文档 §5），masked 供语义确认
    if (isSecretPlaceholder(value)) return { ref: value.ref, masked: value.masked };
    return maskSecretValue(value);
  }
  if (Array.isArray(value)) {
    const itemSchema = schema?.items;
    return value.map((item) => maskForAppendix(item, itemSchema, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const properties = schema?.properties ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskForAppendix(val, properties[key], depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * 结构化附录（```json 代码块）：
 * - 直接来自校验输出 values（不做二次加工），secret 字段打码后进入；
 * - 超过 4KB 上限时整体折叠为说明行（§8 上下文膨胀防线；变量引用通道留待后续任务）。
 */
export function buildResultAppendix(
  values: Record<string, unknown>,
  resultSchema?: TSchema
): string {
  const masked = maskForAppendix(values, resultSchema as SchemaNode | undefined, 0);
  const json = JSON.stringify(masked, null, 2) ?? "{}";
  if (json.length > DIGEST_MAX_APPENDIX_CHARS) {
    return (
      `（结构化附录超过 ${DIGEST_MAX_APPENDIX_CHARS} 字符上限，已按契约折叠：` +
      `共 ${Object.keys(values).length} 个字段，关键字段见上方摘要）`
    );
  }
  return `\`\`\`json\n${json}\n\`\`\``;
}

/** 双层 content 组装：语义摘要 + 结构化附录 */
export function buildDualLayerContent(digest: string, appendix: string): string {
  return `${digest}\n\n${appendix}`;
}

// ==========================================
// 5. 信封 → 双层 content（执行器统一入口）
// ==========================================

export interface InteractionResultContentInput {
  /** 组件/工具标题（缺省回退工具名） */
  title: string;
  envelope: UIActionEnvelope;
  interaction: UIComponentInteraction;
}

/**
 * 声明了 interaction 的工具结果统一走这里（双层 content）：
 * - submit：语义摘要（editedFields 尾句）+ 校验值附录；
 * - cancel：取消语义摘要（无附录——cancel 语义不读取 values）。
 * patch（L3 预留）不唤醒协程、不进模型上下文，不产生 content。
 */
export function buildInteractionResultContent(
  input: InteractionResultContentInput
): string {
  if (input.envelope.kind === "cancel") {
    return digestCancel({ title: input.title, reason: input.envelope.reason });
  }
  if (input.envelope.kind === "submit") {
    const digest = digestSubmit({
      title: input.title,
      values: input.envelope.values,
      resultSchema: input.interaction.resultSchema,
      editedFields: input.envelope.meta?.editedFields,
    });
    return buildDualLayerContent(
      digest,
      buildResultAppendix(input.envelope.values, input.interaction.resultSchema)
    );
  }
  // patch：L3 预留，不产生模型可见 content
  return "";
}
