/** VaSpotlightCard 的类型定义 */

export interface SpotlightCardProps {
  /** accent 发光描边（--va-glow-accent，静态样式非动画，默认开启） */
  glow?: boolean;
  /** 指针光斑（hover 点亮；触屏 / reduced-motion / SSR 自动关闭，默认开启） */
  spot?: boolean;
  /** 投影档位 1-4（--va-shadow-N，默认 4 舞台级深投影） */
  elevation?: number;
}
