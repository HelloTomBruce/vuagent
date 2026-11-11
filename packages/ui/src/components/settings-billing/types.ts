/** VaSettingsBilling 的类型定义 */

export interface BillingPlan {
  id: string;
  name: string;
  /** 价格文案，如 "$20 / 月" */
  price: string;
  features: string[];
  current?: boolean;
  recommended?: boolean;
}

export interface SettingsBillingProps {
  /** 设置区导航（沿用 AppShell 的 NavItem 形状） */
  nav?: Array<{ id: string; label: string; badge?: number }>;
  /** 受控当前设置项 */
  active?: string;
  defaultActive?: string;
  /** 页面标题 */
  title?: string;
  /** 套餐卡；不传则隐藏该区（宿主用 #plans 插槽自定义） */
  plans?: BillingPlan[];
}

export interface SettingsBillingEvents {
  "update:active": [id: string];
  /** 点击套餐卡（升级/降级） */
  choosePlan: [plan: BillingPlan];
}
