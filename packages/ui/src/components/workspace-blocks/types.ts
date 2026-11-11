/** VaPricingPlans / VaAIWorkspace 的类型定义 */

export interface PricingTier {
  id: string;
  name: string;
  price: string;
  /** 价格周期注释，如 "按月" */
  period?: string;
  description?: string;
  features: string[];
  current?: boolean;
  recommended?: boolean;
  ctaLabel?: string;
}

export interface PricingPlansProps {
  tiers: PricingTier[];
  /** 区块标题，默认"选择适合的套餐" */
  title?: string;
}

export interface PricingPlansEvents {
  choose: [tier: PricingTier];
}

/* ---------- AIWorkspace ---------- */

export interface WorkspaceFile {
  id: string;
  name: string;
  status?: "modified" | "added" | "deleted" | "untracked";
}

export interface AIWorkspaceProps {
  files: WorkspaceFile[];
  /** 受控选中文件 id（默认取第一个） */
  selected?: string;
  defaultSelected?: string;
  /** 左侧文件栏标题，默认"工作区文件" */
  filesLabel?: string;
  /** 右侧内容区标题（当前选中文件名） */
  previewLabel?: string;
}

export interface AIWorkspaceEvents {
  "update:selected": [id: string];
  openFile: [file: WorkspaceFile];
}
