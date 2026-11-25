/**
 * 错误反馈横向微振编排（.va-shake 程序化触发器，motion.css 错误反馈标准的 JS 侧）：
 * 返回 shake() 供校验失败时调用（组件经 defineExpose 对宿主暴露）。
 * 动画本体在 CSS（.va-shake + va-motion-shake keyframes）——本 composable 只负责
 * 「同一元素连续触发时重启动画」：动画结束类仍挂在元素上，直接重挂类不会重播，
 * 需先移除、强制 reflow、再挂回（经典 restart 手法，同步无闪烁）。
 *
 * 目标元素二选一：传入既有 template ref（元素已有 ref 时，如 VaOtpInput 的根节点），
 * 或不传——使用组件模板里 ref="shake" 的元素（如 VaStepperForm 的步骤体）。
 * reduced-motion 下 .va-shake 由 motion.css 媒体块降级为不播，本函数无需感知。
 *
 * 可感知性提示：微振只做注意力引导，错误语义应由宿主同时以文案/aria 披露
 * （如 aria-invalid + 错误描述），不能只依赖视觉动效。
 */
import { toValue, useTemplateRef, type MaybeRefOrGetter } from "vue";

export function useShake(target?: MaybeRefOrGetter<HTMLElement | null | undefined>) {
  const fallbackEl = useTemplateRef<HTMLElement>("shake");

  /** 播放一次微振：移除类 → 强制 reflow → 挂回（同一元素连续调用同样有效） */
  function shake() {
    const node = target !== undefined ? toValue(target) : fallbackEl.value;
    if (!node) return;
    node.classList.remove("va-shake");
    void node.offsetWidth; // 强制 reflow：重启 animation
    node.classList.add("va-shake");
  }

  return { shake };
}
