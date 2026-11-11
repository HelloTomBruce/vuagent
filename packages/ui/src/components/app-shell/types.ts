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
  nav: NavItem[];
  /** 受控当前导航项（配合 @update:active 实现 v-model:active） */
  active?: string;
  defaultActive?: string;
  /** 窄屏（<960px）侧栏抽屉态受控 */
  sidebarOpen?: boolean;
}

export interface AppShellEvents {
  "update:active": [id: string];
  /** 点击导航项 */
  navigate: [item: NavItem];
  "update:sidebarOpen": [v: boolean];
}
