/** VaAppShell 的类型定义 */

export interface NavItem {
  id: string;
  label: string;
  /** 徽标数（未读等） */
  badge?: number;
  disabled?: boolean;
}

export interface AppShellProps {
  /** 品牌名，侧栏顶部 */
  brand?: string;
  nav?: NavItem[];
  /** 受控当前导航项（配合 @update:active 实现 v-model:active） */
  active?: string;
  defaultActive?: string;
  /** 窄屏（<960px）侧栏抽屉态受控 */
  sidebarOpen?: boolean;
  /** 是否显示侧栏折叠按钮（rail 模式，64px 图标列） */
  collapsible?: boolean;
  /** 折叠态受控（配合 @update:collapsed；宿主可绑 Mod+B） */
  collapsed?: boolean;
  /** 侧栏宽度 px（默认 264；折叠时固定 64） */
  sidebarWidth?: number;
  /** 内容区零内边距（应用类页面自行掌控布局，如三栏控制台） */
  flushContent?: boolean;
  /**
   * 锁定视口高度模式（对话 / 控制台类页面）：壳整体 100vh，
   * 内容区自身滚动（overflow-y: auto），页面内部可以再做固定高度的
   * 流式布局（如 chat-stream + composer）。默认 false 保持文档流
   * 页面滚动（文档 / 长列表类页面）。
   */
  bounded?: boolean;
}

export interface AppShellEvents {
  "update:active": [id: string];
  /** 点击导航项 */
  navigate: [item: NavItem];
  "update:sidebarOpen": [v: boolean];
  /** 请求切换折叠态（内置按钮或宿主快捷键触发） */
  "update:collapsed": [v: boolean];
}
