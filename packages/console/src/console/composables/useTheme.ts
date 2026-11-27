/**
 * Playground 宿主主题切换（TASK-006/TASK-067）
 *
 * 三态模型：light / dark / system（跟随 prefers-color-scheme）
 * - 持久化：localStorage("vuagent:theme")，容错解析，坏值回退 system
 * - 生效：写 documentElement 的 data-theme 属性 + color-scheme（原生滚动条/
 *   表单控件跟随），tokens.css 双选择器 [data-theme="dark"], .dark 均命中
 * - system 态监听 matchMedia change 实时跟随系统切换
 * - 与 index.html 内联首屏脚本（FOUC 防护）使用同一 storage key 与解析规则
 */
import { ref, watchEffect, type Ref } from "vue";

export type ThemePreference = "light" | "dark" | "system";
/** 实际生效主题（system 解析后） */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "vuagent:theme";

const PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

function resolveStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined; // 隐私模式等 storage 不可用场景：仅内存态
  }
}

function loadPreference(storage: Storage | undefined): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.includes(raw as ThemePreference)
      ? (raw as ThemePreference)
      : "system";
  } catch {
    return "system";
  }
}

export interface ThemeStore {
  /** 用户偏好（三态） */
  preference: Ref<ThemePreference>;
  /** 实际生效主题（system 解析结果），供 UI 显示当前态 */
  resolved: Ref<ResolvedTheme>;
  setPreference(value: ThemePreference): void;
}

export function createThemeStore(storage: Storage | undefined = resolveStorage()): ThemeStore {
  const preference = ref<ThemePreference>(loadPreference(storage));
  const resolved = ref<ResolvedTheme>("light");

  const media =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : undefined;

  function apply(): void {
    const dark =
      preference.value === "dark" || (preference.value === "system" && !!media?.matches);
    resolved.value = dark ? "dark" : "light";
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = resolved.value;
      document.documentElement.style.colorScheme = resolved.value;
    }
  }

  // system 态实时跟随系统切换
  if (media) {
    media.addEventListener("change", () => {
      if (preference.value === "system") apply();
    });
  }

  function persist(): void {
    try {
      storage?.setItem(THEME_STORAGE_KEY, preference.value);
    } catch {
      // 持久化失败不阻断运行态
    }
  }

  // 偏好变更 → 持久化 + 重应用
  watchEffect(() => {
    persist();
    apply();
  });

  return {
    preference,
    resolved,
    setPreference(value: ThemePreference) {
      preference.value = value;
      // 同步持久化 + 应用（watchEffect 重跑是微任务级，这里立即生效保证切换
      // 当帧可见且写盘确定；watchEffect 随后仍会执行一次幂等的 persist + apply）
      persist();
      apply();
    },
  };
}

/** 模块级单例：App.vue 与设置面板共享同一主题状态 */
let singleton: ThemeStore | null = null;

export function useTheme(): ThemeStore {
  if (!singleton) singleton = createThemeStore();
  return singleton;
}
