import { computed } from "vue";
import { useSpotlight } from "../../composables/useSpotlight";
import type { SpotlightCardProps } from "./types";

/**
 * VaSpotlightCard 的组装逻辑（可测）：elevation 档位钳制 + 修饰类推导 + 光斑指针桥接。
 * 光斑几何与环境分频复用共享 useSpotlight（rAF 节流写 --va-spot-x/y；
 * hover: none / reduced-motion / SSR 短路），组件 CSS 只负责 radial 绘制与显隐。
 * spot 启用态按范式一次性读取（props.spot === false 关闭），运行时切换不重探环境。
 */

/** elevation 钳制到 1-4 档（undefined / NaN 回 4 舞台档，越界取最近档） */
export function clampElevation(value: number | undefined): number {
  const n = Math.round(Number(value ?? 4));
  if (Number.isNaN(n)) return 4;
  return Math.min(4, Math.max(1, n));
}

export function useSpotlightCard(props: SpotlightCardProps) {
  const spot = useSpotlight({ disabled: props.spot === false });

  const classes = computed(() => {
    const list = ["va-spot-card", `va-spot-card--e${clampElevation(props.elevation)}`];
    if (props.glow !== false) list.push("va-spot-card--glow");
    if (props.spot !== false) list.push("va-spot-card--spot");
    return list;
  });

  return { classes, spot };
}
