import { computed } from "vue";
import type { GridBackgroundProps, GridDirection } from "./types";

const OFFSET: Record<GridDirection, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  diagonal: [-1, 1],
};

/** VaGridBackground 的状态逻辑：漂移距离/周期/遮罩 */
export function useGridBackground(props: GridBackgroundProps) {
  const size = computed(() => Math.max(8, props.size ?? 44));
  const speed = computed(() => props.speed ?? 2.4);
  const moving = computed(() => speed.value > 0);

  /** 一次动画循环漂移 4 格，方向取负（背景位移与视觉漂移方向相反） */
  const drift = computed<[number, number]>(() => {
    const [x, y] = OFFSET[props.direction ?? "diagonal"];
    return [x * size.value * 4, y * size.value * 4];
  });
  const duration = computed(() => `${speed.value * 4}s`);

  const lineColor = computed(() => props.color ?? "var(--va-edge, rgba(26, 25, 23, 0.12))");
  const maskImage = computed(() => {
    const fade = Math.min(100, Math.max(0, props.fade ?? 70));
    if (fade <= 0) return undefined;
    const stop = 100 - fade / 2;
    return `radial-gradient(ellipse at center, #000 ${stop}%, transparent 100%)`;
  });

  const bgStyle = computed(() => ({
    backgroundSize: `${size.value}px ${size.value}px`,
    backgroundImage: `linear-gradient(to right, ${lineColor.value} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor.value} 1px, transparent 1px)`,
    maskImage: maskImage.value,
    WebkitMaskImage: maskImage.value,
  }));

  const animStyle = computed(() =>
    moving.value
      ? {
          "--va-grid-from": "0 0",
          "--va-grid-to": `${drift.value[0]}px ${drift.value[1]}px`,
          animationDuration: duration.value,
        }
      : undefined,
  );

  return { bgStyle, animStyle, moving };
}
