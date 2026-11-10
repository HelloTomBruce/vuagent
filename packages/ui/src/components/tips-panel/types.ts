/** VaTipsPanel 的类型定义 */

export interface TipItem {
  id: string;
  title: string;
  body: string;
}

export interface TipsPanelProps {
  tips: TipItem[];
  /** 面板标题，默认"使用技巧" */
  title?: string;
  /** 单条 tip 可关闭 */
  dismissible?: boolean;
  /** 全部关闭后显示的文案；空字符串则整卡隐藏 */
  emptyLabel?: string;
}

export interface TipsPanelEvents {
  dismiss: [id: string];
}
