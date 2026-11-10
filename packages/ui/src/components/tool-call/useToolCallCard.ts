import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { TOOL_CALL_GROUP_KEY } from "./context";
import type { ToolCallCardProps } from "./types";
import { formatMs, toDisplayText } from "../../utils/format";
import { useNow } from "../../composables/useNow";

/**
 * VaToolCallCard 的状态逻辑：
 * - running 态实时计时（共享 useNow 时钟）
 * - 失败自动展开、下次运行自动收起（用户手动操作过则不干预）
 * - 参数/结果展示文本与折叠
 * - 元信息上报给外层 VaToolCallGroup
 */
export function useToolCallCard(
  props: ToolCallCardProps,
  emitUpdateOpen: (v: boolean) => void,
) {
  /* ---------- 分组注册 ---------- */
  const group = inject(TOOL_CALL_GROUP_KEY, null);

  /**
   * 展开状态三段判定：
   * 1) 父层绑定 v-model:open（props.open !== undefined）→ 受控跟随父层
   * 2) 组件内被点过/自动展开过 → 用内部值
   * 3) 从未操作 → 回落 defaultOpen
   * （不用 defineModel：Vue 对 Boolean prop 有 cast，未绑定时其本地值为 false，无法区分"未绑定"与"绑定 false"）
   */
  const innerOpen = ref(false);
  const openTouched = ref(false);
  const isOpen = computed(() => {
    if (props.open !== undefined) return props.open;
    if (openTouched.value) return innerOpen.value;
    return props.defaultOpen ?? false;
  });
  function setOpen(v: boolean) {
    openTouched.value = true;
    innerOpen.value = v;
    emitUpdateOpen(v);
  }

  /* ---------- 计时 ---------- */
  const isRunning = computed(() => props.status === "running" && props.startedAt != null);
  const now = useNow(200, isRunning);
  const stoppedAt = ref<number | undefined>(undefined);

  watch(isRunning, (v) => {
    if (!v) stoppedAt.value = elapsedRaw.value || undefined;
  });

  const elapsedRaw = computed(() => (props.startedAt != null ? Math.max(0, now.value - props.startedAt) : 0));

  const timeMs = computed(() => {
    if (props.status === "running") return elapsedRaw.value;
    if (props.duration != null) return props.duration;
    return stoppedAt.value ?? 0;
  });
  const timeLabel = computed(() => formatMs(timeMs.value));

  /* ---------- 失败自动展开 ---------- */
  const autoOpened = ref(false);
  watch(
    () => props.status,
    (to, from) => {
      if (!props.openOnError || openTouched.value) return;
      if (to === "error" && from !== "error" && !isOpen.value) {
        setOpen(true);
        autoOpened.value = true;
      } else if (from === "error" && to !== "error" && autoOpened.value) {
        setOpen(false);
        autoOpened.value = false;
      }
    },
  );

  function toggle() {
    setOpen(!isOpen.value);
  }

  /* ---------- 内容 ---------- */
  const argsText = computed(() => toDisplayText(props.args));
  const resultText = computed(() => (props.status === "error" ? "" : toDisplayText(props.result)));
  const expanded = ref<Record<string, boolean>>({});
  function isLong(text: string) {
    return text.length > 400;
  }

  /* ---------- 元信息上报 ---------- */
  const id = `va-tcl-${Math.random().toString(36).slice(2, 8)}`;
  const getMeta = () => ({
    name: props.name,
    status: props.status,
    duration: props.status === "running" ? undefined : (props.duration ?? stoppedAt.value),
    hasIcon: true,
  });
  // 初始就是 error（父层数据先行）时也自动展开一次
  onMounted(() => {
    group?.register(getMeta);
    if (props.status === "error" && props.openOnError && !isOpen.value) {
      setOpen(true);
      autoOpened.value = true;
    }
  });
  onBeforeUnmount(() => {
    group?.unregister(getMeta);
  });

  return {
    id,
    isOpen,
    timeLabel,
    timeMs,
    argsText,
    resultText,
    expanded,
    isLong,
    toggle,
  };
}
