/** VaOnboarding 的类型定义 */

export interface OnboardingProps {
  /** 主标题 */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 主 CTA 文案与事件 */
  ctaLabel?: string;
  /** 次 CTA（如"看文档"） */
  secondaryCtaLabel?: string;
  /** 品牌小字 */
  brand?: string;
}

export interface OnboardingEvents {
  /** 点击主 CTA */
  cta: [];
  /** 点击次 CTA */
  secondaryCta: [];
}
