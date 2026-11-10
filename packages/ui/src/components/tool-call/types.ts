/** VaToolCallCard / VaToolCallGroup 的类型定义 */

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallCardProps {
  /** 工具名，等宽展示，如 search_web */
  name: string;
  /** 一句人话摘要 */
  summary?: string;
  status: ToolCallStatus;
  /** 调用参数：对象会被美化，JSON 字符串会被解析后美化 */
  args?: unknown;
  /** 返回结果：同上 */
  result?: unknown;
  /** status 为 error 时展示的错误信息 */
  error?: string;
  /** 开始时间（ms 时间戳），running 态的实时计时起点 */
  startedAt?: number;
  /** 最终耗时 ms；不传时由组件在结束时测量 */
  duration?: number;
  /** 参数/结果超出该高度后折叠，点击展开 */
  maxCodeHeight?: number;
  /** 失败时自动展开、下次运行自动收起（用户手动操作过则不干预） */
  openOnError?: boolean;
  /** 初始展开（父层未绑定 v-model:open 时生效） */
  defaultOpen?: boolean;
  /** 受控展开状态（配合 @update:open 实现 v-model:open） */
  open?: boolean;
}

export interface ToolCallCardEvents {
  retry: [];
  "update:open": [v: boolean];
}

export interface ToolCallGroupProps {
  /** 全部结束后的标签，默认"使用了 N 个工具" */
  label?: string;
  /** 有卡在跑时的标签，默认"正在执行工具…" */
  runningLabel?: string;
  /** 总耗时 ms；不传时由组件汇总各卡的耗时 */
  duration?: number;
  /** 初始展开（父层未绑定 v-model:open 时生效） */
  defaultOpen?: boolean;
  /** 受控展开状态（配合 @update:open 实现 v-model:open） */
  open?: boolean;
}

export interface ToolCallGroupEvents {
  "update:open": [v: boolean];
}

/** VaToolCallCard 向外层 VaToolCallGroup 注册的元信息 */
export interface ToolCallMeta {
  name: string;
  status: ToolCallStatus;
  /** 结束后的最终耗时；running 时为 undefined */
  duration?: number;
  hasIcon: boolean;
}
