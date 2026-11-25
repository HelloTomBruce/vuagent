import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { TrajEvent } from "./types";

/**
 * VaTrajectory 渐进揭示（TASK-107 零动效补齐，克制版 scroll 驱动）：
 * IntersectionObserver 进视口逐节点点亮——台账行 opacity/translateY 过渡 +
 * 左侧连接线 scaleY 渐进描线 + 节点 scale 点亮；泳道块随泳道区进入视口一次性浮现。
 * IO 一次性触发（点亮即 unobserve），不监听滚动、不做 scroll-jack，不改变布局
 * （仅 opacity/transform，不引起滚动抖动，stick-to-bottom 契约安全）。
 *
 * 降级：reduced-motion / 无 IntersectionObserver / SSR 时不激活（data-reveal 不挂载，
 * CSS 仅在 [data-reveal="on"] 下生效）——内容直接全显，服务端与客户端首帧输出一致。
 * IO 守卫范式照抄 composables 同族（useNumberTicker/useTextReveal 的 matchMedia 短链）。
 */
export function useTrajectoryReveal(root: Ref<HTMLElement | null>, filtered: Ref<TrajEvent[]>) {
  /** 渐进揭示是否激活（挂载后 IO 可用且未 reduced-motion 才为 true） */
  const active = ref(false);
  /** 已点亮的台账行事件 id 集合（搜索过滤往返不重放：点亮后保持） */
  const shownIds = ref(new Set<string>());
  /** 泳道区是否已进入视口（泳道块整体一次性浮现） */
  const lanesShown = ref(false);
  let io: IntersectionObserver | null = null;

  /** 台账行是否已点亮（未激活时恒 true → 模板 data-shown 不挂载，全显） */
  function rowVisible(id: string): boolean {
    return !active.value || shownIds.value.has(id);
  }
  /** 泳道块是否可见（未激活时恒 true） */
  const blocksVisible = computed(() => !active.value || lanesShown.value);

  /** 对当前 DOM 重建观察：泳道区（未点亮时）+ 全部尚未点亮的台账行 */
  async function observeAll() {
    await nextTick();
    const el = root.value;
    if (!el || !io) return;
    io.disconnect();
    if (!lanesShown.value) {
      const lanes = el.querySelector<HTMLElement>(".va-traj__lanes");
      if (lanes) io.observe(lanes);
    }
    for (const row of el.querySelectorAll<HTMLElement>(".va-traj__row[data-id]")) {
      const id = row.dataset.id;
      if (id && !shownIds.value.has(id)) io.observe(row);
    }
  }

  onMounted(() => {
    const el = root.value;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;
    active.value = true;
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          if (target.classList.contains("va-traj__lanes")) {
            lanesShown.value = true;
          } else if (target.dataset.id) {
            const next = new Set(shownIds.value);
            next.add(target.dataset.id);
            shownIds.value = next;
          }
          io?.unobserve(target);
        }
      },
      { threshold: 0.15 },
    );
    void observeAll();
  });

  // 搜索过滤 / events 追加后，对新增（尚未点亮）的行重建观察
  watch(filtered, () => {
    if (active.value) void observeAll();
  });

  onBeforeUnmount(() => {
    io?.disconnect();
    io = null;
  });

  return { active, rowVisible, blocksVisible };
}
