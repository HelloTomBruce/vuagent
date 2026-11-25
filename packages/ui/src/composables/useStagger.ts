/**
 * 列表子项进出场错峰编排（TASK-102 动效基建）：
 * 返回 delayStyle(index) 供 v-for 子项绑定 :style，配合 .va-enter-* 动画类使用
 * （.va-enter-* 全是 CSS animation，延迟轴为 animation-delay——transition-delay
 * 对 animation 零作用；动画 fill-mode both 保首帧，延迟期间不闪跳）。
 * 步长口径对齐 tokens.css 的 --va-stagger（40ms）；
 * reduced-motion 下延迟归零（动画降级本身由 motion.css 媒体查询处理）。
 *
 * SSR 安全：无 window/matchMedia 时跳过检测、按正常分支返回——服务端与
 * 非 reduced 客户端的首帧输出一致，避免 hydration 抖动；reduced-motion 客户端
 * 首帧为全 0ms、与服务端错峰值有差异，由 Vue hydration 后补丁收敛（轻微）。
 * reduced-motion 检测照抄现有 composable
 * 范式（window.matchMedia?.() 整链短路），挂载时机一次性读取，不监听系统切换。
 */
export interface UseStaggerOptions {
  /** 相邻子项延迟步长 ms（默认 40，同 --va-stagger） */
  stepMs?: number;
  /** 错峰档位上限：index 超过后钳制在档顶（默认 8，防长列表末项等待过久） */
  maxItems?: number;
  /** 置真时恒返回 0ms 延迟（宿主自行关闭错峰） */
  disabled?: boolean;
}

export function useStagger(options: UseStaggerOptions = {}) {
  const stepMs = options.stepMs ?? 40;
  const maxItems = options.maxItems ?? 8;
  const disabled = options.disabled ?? false;

  const reduced =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

  /** 配合 .va-enter-* 动画类使用：animation-delay 按 0 起步长递增，超过档位上限后钳制 */
  function delayStyle(index: number): Record<string, string> {
    if (reduced || disabled) return { "animation-delay": "0ms" };
    const delay = Math.min(Math.max(index, 0), maxItems) * stepMs;
    return { "animation-delay": `${delay}ms` };
  }

  return { delayStyle };
}
