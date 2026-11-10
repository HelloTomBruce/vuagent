import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { TextRevealProps } from "./types";

/** VaTextReveal 的状态逻辑：切分片段 + IntersectionObserver 触发浮现。root 由 SFC 传入 */
export function useTextReveal(props: TextRevealProps, root: Ref<HTMLElement | null>) {
  const shown = ref(false);
  let io: IntersectionObserver | null = null;

  /** 按粒度切分（保留空格节奏） */
  const pieces = computed(() => {
    if (props.by === "char") return Array.from(props.text);
    return props.text.split(/(\s+)/).filter((s) => s.length > 0);
  });

  onMounted(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shown.value = true;
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      shown.value = true;
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          shown.value = true;
          if (props.once) {
            io?.disconnect();
            io = null;
          }
        } else if (!props.once) {
          shown.value = false;
        }
      },
      { threshold: 0.3 },
    );
    io.observe(root.value!);
  });

  onBeforeUnmount(() => io?.disconnect());

  /** 单段的过渡样式：错峰延迟 */
  function pieceStyle(i: number) {
    return {
      transitionDelay: `${(props.delay ?? 0) + i * (props.stagger ?? 40)}ms`,
      transitionDuration: `${props.duration ?? 600}ms`,
    };
  }

  return { root, shown, pieces, pieceStyle };
}
