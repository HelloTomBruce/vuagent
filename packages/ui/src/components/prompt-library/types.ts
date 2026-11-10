/** VaPromptLibrary 的类型定义 */

export interface PromptItem {
  id: string;
  title: string;
  /** 提示词正文 */
  body: string;
  category?: string;
  /** 用途标签 */
  tags?: string[];
}

export interface PromptLibraryProps {
  prompts: PromptItem[];
  /** 受控搜索词（不绑则组件内部维护） */
  query?: string;
  placeholder?: string;
  /** 卡片正文折叠高度 px，默认 88 */
  bodyClamp?: number;
  /** 空态文案 */
  emptyLabel?: string;
}

export interface PromptLibraryEvents {
  /** 点击"使用" */
  use: [prompt: PromptItem];
  /** 搜索词变化（仅宿主受控 query 时需要处理） */
  "update:query": [v: string];
}
