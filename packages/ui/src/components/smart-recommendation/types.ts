/** VaSmartRecommendation 的类型定义 */

export interface RecommendationAction {
  id: string;
  label: string;
  /** 主要操作（accent 实底）；默认次要样式 */
  primary?: boolean;
}

export interface SmartRecommendationProps {
  /** 建议标题 */
  title: string;
  /** 建议理由/说明 */
  description?: string;
  actions: RecommendationAction[];
  /** 预期收益标签（如 "预计省 30% tokens"） */
  impact?: string;
  /** 右上角关闭 ×；false 时只显示 actions */
  dismissible?: boolean;
  /** 关闭按钮 aria-label */
  dismissLabel?: string;
}

export interface SmartRecommendationEvents {
  /** 点击某个操作（携带 action id） */
  action: [id: string];
  /** 点击关闭 */
  dismiss: [];
}
