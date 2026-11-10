/** VaNumberTicker 的类型定义 */

export interface NumberTickerProps {
  /** 要展示的数字 */
  value: number;
  /** Intl.NumberFormat 选项，如 { style: "currency", currency: "USD" } */
  format?: Intl.NumberFormatOptions;
  /** 地区，如 "en-US"；默认跟随浏览器 */
  locale?: string;
  /** 一次滚动的毫秒数 */
  duration?: number;
  /** 首次进入视口后的等待毫秒数 */
  delay?: number;
}

/** 数字滚筒的单列 */
export interface TickerPart {
  key: string;
  digit?: number;
  char?: string;
}
