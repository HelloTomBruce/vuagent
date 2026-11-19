/**
 * Harness 配置中心 Schema（TASK-024）
 *
 * 配置项的唯一来源：命名空间 → 字段描述表。
 * - 前端设置页表驱动渲染（对齐 TASK-017 描述表模式），新增配置项只需在此追加条目；
 * - resolver 读路径以它为容错准绳（未知 key 忽略 / 类型不符回落默认 / 越界钳制）；
 * - 路由写路径以它为严格校验准绳（未知 key、类型不符、env 锁定 → 400）。
 *
 * 默认值与现行硬编码行为严格等价（下游任务接线时不得改变默认语义）：
 * maxSteps=15（agent-loop.ts）、approvalTimeoutMs=180_000（action-hub.ts HITL 挂起）、
 * contextBudgetRatio=0.85（agent-loop.ts）、preserveRecentTurns=4 /
 * maxToolResultChars=2000（context-compactor.ts）、
 * bashTimeoutCeilingMs=60_000（tool-registry.ts 执行器超时上限，bash_run 命令超时的全局封顶）。
 * turnTimeoutMs=600_000 是 TASK-048 新增能力（整轮看门狗，修复 SSE 停滞永久挂起），
 * 非既有硬编码行为的搬移；与 approvalTimeoutMs（审批挂起等待人工）语义正交，勿混淆。
 */

/** 字段控件类型：boolean→开关、number→数字输入、string→单行文本、text→多行文本、select→下拉 */
export type ConfigFieldType = "boolean" | "number" | "string" | "text" | "select";

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigFieldSchema {
  key: string;
  title: string;
  description: string;
  type: ConfigFieldType;
  /** 内置默认值（解析链最底层） */
  default: unknown;
  /** number 类型的取值范围（越界钳制） */
  min?: number;
  max?: number;
  /** string/text 类型的长度上限（超长截断） */
  maxLength?: number;
  /** select 类型的可选项 */
  options?: ConfigFieldOption[];
  /** 风险标记：高风险配置项在 UI 展示风险徽标 */
  risk?: "high" | "medium" | "low";
  /**
   * 部署级强制锁：该环境变量显式设置时，字段生效值由 env 决定
   * （读路径 env 优先、写路径 PATCH 拒绝、UI 只读展示锁标记）。
   */
  envLock?: string;
}

export interface ConfigNamespaceSchema {
  id: string;
  title: string;
  description: string;
  fields: ConfigFieldSchema[];
}

/** 配置命名空间描述表（数组顺序即 UI 渲染顺序） */
export const CONFIG_SCHEMA: ConfigNamespaceSchema[] = [
  {
    id: "execution",
    title: "执行",
    description: "ReAct 循环步数、超时与上下文预算",
    fields: [
      {
        key: "maxSteps",
        title: "单轮最大步数",
        description: "单轮执行允许的模型-工具往返上限，达到后强制收尾",
        type: "number",
        default: 15,
        min: 1,
        max: 100,
      },
      {
        key: "approvalTimeoutMs",
        title: "审批挂起超时（毫秒）",
        description: "HITL 审批挂起等待人工决策的时长，超时自动驳回",
        type: "number",
        default: 180_000,
        min: 10_000,
        max: 600_000,
      },
      {
        key: "contextBudgetRatio",
        title: "上下文预算比例",
        description: "相对模型上下文窗口的可用预算，超出后触发滑动窗口裁剪",
        type: "number",
        default: 0.85,
        min: 0.5,
        max: 0.95,
      },
      {
        key: "preserveRecentTurns",
        title: "裁剪保留最近轮数",
        description: "滑动窗口裁剪时始终保留的最近对话轮数",
        type: "number",
        default: 4,
        min: 1,
        max: 20,
      },
      {
        key: "maxToolResultChars",
        title: "工具结果截断长度",
        description: "单条工具执行结果注入上下文的最大字符数，超出截断",
        type: "number",
        default: 2_000,
        min: 200,
        max: 30_000,
      },
      {
        key: "turnTimeoutMs",
        title: "单轮执行超时（毫秒）",
        description:
          "整轮执行的看门狗上限：超时自动中止并保留已完成进度（TASK-048 新增能力，" +
          "此前轮次可因模型流停滞永久挂起）。请求级 timeoutMs 可逐请求覆盖（同样受钳制）",
        type: "number",
        default: 600_000,
        min: 30_000,
        max: 3_600_000,
      },
      {
        key: "maxConcurrentTurns",
        title: "全局并发轮次上限",
        description:
          "同时处于 running 状态的轮次数上限（TASK-052 并发准入）：0 = 不限；" +
          "超限时新请求 429 拒绝（运行中改档即时生效）",
        type: "number",
        default: 0,
        min: 0,
        max: 64,
        risk: "high",
      },
    ],
  },
  {
    id: "security",
    title: "安全",
    description: "默认权限模式与网络边界；环境变量锁定项不可在此修改",
    fields: [
      {
        key: "defaultPermissionMode",
        title: "默认权限模式",
        description: "新建会话的缺省权限模式（会话内可再单独调整）",
        type: "select",
        default: "review",
        options: [
          { value: "review", label: "严格审批 (Review)" },
          { value: "auto", label: "自动执行 (Auto)" },
          { value: "read-only", label: "只读沙箱 (Read-Only)" },
        ],
      },
      {
        key: "allowPrivateFetch",
        title: "允许抓取私网地址",
        description: "放行 web_fetch 访问内网/本机地址（SSRF 面扩大，仅内网联调时开启）",
        type: "boolean",
        default: false,
        risk: "high",
        envLock: "VUAGENT_ALLOW_PRIVATE_FETCH",
      },
      {
        key: "allowByoProvider",
        title: "允许前端自备供应商配置",
        description: "放行请求自带 baseUrl/apiKey（SSRF 面，默认拒绝）",
        type: "boolean",
        default: false,
        risk: "high",
        envLock: "VUAGENT_ALLOW_BYO_PROVIDER",
      },
    ],
  },
  {
    id: "tools",
    title: "工具",
    description: "工具执行策略；per-tool 覆盖（启停/超时/审批）在「工具」页按工具配置",
    fields: [
      {
        key: "bashTimeoutCeilingMs",
        title: "Bash 超时上限（毫秒）",
        description:
          "bash_run 命令超时的全局封顶：模型请求值与 per-tool timeoutMs 覆盖都不会超过它（执行器超时上限同源）",
        type: "number",
        default: 60_000,
        min: 1_000,
        max: 600_000,
      },
    ],
  },
  {
    id: "prompt",
    title: "提示词",
    description: "系统提示的组装块与全局自定义指令",
    fields: [
      {
        key: "customInstructions",
        title: "全局自定义指令",
        description: "追加到系统提示末尾的用户指令（纯文本，不能覆盖内置安全与工具契约块）",
        type: "text",
        default: "",
        maxLength: 4_000,
      },
      {
        key: "includeEnvironmentBlock",
        title: "包含运行环境块",
        description: "系统提示中注入操作系统/Shell/时区等运行环境信息",
        type: "boolean",
        default: true,
      },
      {
        key: "includePermissionBlock",
        title: "包含权限说明块",
        description: "系统提示中向模型说明当前权限模式的行为边界",
        type: "boolean",
        default: true,
      },
    ],
  },
  {
    id: "finops",
    title: "成本配额",
    description: "滚动窗口 Token/费用配额准入（TASK-052）；0 = 不限，缺省全关保持向后兼容",
    fields: [
      {
        key: "windowTokenLimit",
        title: "窗口 Token 上限",
        description:
          "滚动窗口内全租户（本地单用户即全局）累计 token 上限，达到后新请求 429 拒绝；0 = 不限",
        type: "number",
        default: 0,
        min: 0,
        max: 1_000_000_000,
      },
      {
        key: "windowUsdLimit",
        title: "窗口费用上限（USD）",
        description:
          "滚动窗口内累计费用上限（计价表 config/model-pricing.json 命中才记钱）；0 = 不限",
        type: "number",
        default: 0,
        min: 0,
        max: 100_000,
      },
      {
        key: "windowMs",
        title: "配额滚动窗口（毫秒）",
        description: "配额累计的滚动窗口宽度，缺省 24 小时",
        type: "number",
        default: 86_400_000,
        min: 60_000,
        max: 2_592_000_000,
      },
    ],
  },
];

export function getNamespaceSchema(id: string): ConfigNamespaceSchema | undefined {
  return CONFIG_SCHEMA.find((ns) => ns.id === id);
}

/** 命名空间的全默认值（解析链最底层快照） */
export function defaultNamespaceValues(ns: ConfigNamespaceSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ns.fields) out[f.key] = f.default;
  return out;
}
