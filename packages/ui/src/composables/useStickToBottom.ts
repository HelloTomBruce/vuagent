/**
 * 贴底跟随滚动（stick-to-bottom）：与 VaTerminalLog 的「贴底时跟随，上翻暂停」同一约定。
 *
 * 修复痛点：流式输出期间每个 SSE 数据块都无条件 scrollTop = scrollHeight，
 * 用户上翻查看历史时被持续拽回底部，滚轮与强制滚动互相打架导致「一卡一卡」。
 *
 * 行为契约：
 * - 用户处于底部（距底 < threshold px，默认 64）时，流式内容自动跟随到底；
 * - 用户主动上翻超过阈值后，流式期间不再强制滚动，阅读位置保持稳定；
 * - 用户滚回底部自动恢复跟随；发送消息 / 切换会话等场景走 force 通道强制回底；
 * - 同一帧内的多次调用经 requestAnimationFrame 合并为一次滚动。
 */
import { getCurrentInstance, onBeforeUnmount, ref } from "vue";
import type { Ref } from "vue";

/** 默认距底部多少像素以内视为「贴底」（聊天流内容较高，略宽于终端流的 32px） */
export const BOTTOM_THRESHOLD_PX = 64;

export interface ScrollToBottomOptions {
  /** 强制滚到底（用户发送消息 / 切换会话等显式上下文），无视当前钉底状态 */
  force?: boolean;
}

export interface UseStickToBottomOptions {
  /** 距底部多少像素以内视为「贴底」（默认 64；终端流等密集内容可用 32） */
  threshold?: number;
}

export function useStickToBottom(
  scrollRef: Ref<HTMLElement | null>,
  options?: UseStickToBottomOptions,
) {
  const threshold = options?.threshold ?? BOTTOM_THRESHOLD_PX;

  /** 是否钉在底部（跟随流式输出）；用户上翻超过阈值即解除 */
  const isPinned = ref(true);

  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
  let pendingForce = false;

  /** 依据当前滚动位置重算钉底状态（滚动容器 scroll 事件里调用） */
  function updatePinned() {
    const el = scrollRef.value;
    if (!el) return;
    isPinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  /** 滚动事件处理器（模板里 @scroll.passive 绑定） */
  function onScroll() {
    updatePinned();
  }

  /**
   * 请求滚到底部：默认仅在钉底状态下生效（跟随模式），force 时无条件滚动。
   * 多次调用在同一帧内合并；rAF 晚于 Vue 的 DOM patch（microtask），
   * 执行时 scrollHeight 已是流式更新后的最新值。
   */
  function scrollToBottom(options?: ScrollToBottomOptions) {
    if (options?.force) pendingForce = true;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const force = pendingForce;
      pendingForce = false;
      if (!force && !isPinned.value) return;
      const el = scrollRef.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function dispose() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      pendingForce = false;
    }
  }

  // 仅在组件作用域内注册卸载钩子（单测等非组件环境直接调 dispose）
  if (getCurrentInstance()) {
    onBeforeUnmount(dispose);
  }

  return { isPinned, onScroll, updatePinned, scrollToBottom, dispose };
}
