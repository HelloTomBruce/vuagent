import { computed, provide, ref } from "vue";
import { TOOL_CALL_GROUP_KEY } from "./context";
import type { ToolCallGroupProps, ToolCallMeta } from "./types";
import { formatMs } from "../../utils/format";

/**
 * VaToolCallGroup 的状态逻辑：
 * 卡片自动注册 → 汇总运行状态 / 失败数 / 总耗时 → 生成标题。
 */
export function useToolCallGroup(props: ToolCallGroupProps) {
  const getters = ref<Array<() => ToolCallMeta>>([]);

  provide(TOOL_CALL_GROUP_KEY, {
    register: (get) => getters.value.push(get),
    unregister: (get) => {
      const i = getters.value.indexOf(get);
      if (i >= 0) getters.value.splice(i, 1);
    },
  });

  const cards = computed(() => getters.value.map((get) => get()));
  const running = computed(() => cards.value.some((c) => c.status === "running"));
  const failed = computed(() => cards.value.filter((c) => c.status === "error").length);
  const total = computed(() => {
    if (running.value) return undefined;
    if (props.duration != null) return props.duration;
    if (cards.value.length && cards.value.every((c) => c.duration != null)) {
      return cards.value.reduce((t, c) => t + (c.duration ?? 0), 0);
    }
    return undefined;
  });

  const title = computed(() => {
    if (running.value) return props.runningLabel ?? "正在执行工具…";
    const n = cards.value.length;
    const base = props.label ?? `使用了 ${n} 个工具`;
    const bits = [base];
    if (failed.value) bits.push(`${failed.value} 失败`);
    if (total.value != null) bits.push(formatMs(total.value));
    return bits.join(" · ");
  });

  return { cards, running, failed, total, title };
}
