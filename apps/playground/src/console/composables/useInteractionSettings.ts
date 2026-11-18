/**
 * 交互偏好设置数据层（TASK-015）
 * - 可扩展结构：InteractionSettings 为版本化对象，新增配置项只需加字段 + 默认值
 * - 持久化：localStorage("vuagent:interaction-settings")，JSON 含 version 便于将来迁移
 * - 纯逻辑（load/save/merge）与 Vue 响应式解耦，node 环境下可注入 storage 适配器单测
 */
import { ref, watch, type Ref } from "vue";

/** localStorage 持久化 key */
export const INTERACTION_SETTINGS_STORAGE_KEY = "vuagent:interaction-settings";

/** 当前设置结构版本；新增字段/语义变更时递增并在 load 中做迁移 */
export const INTERACTION_SETTINGS_VERSION = 1;

/**
 * 交互偏好设置（v1）
 * - autoCollapseThought：思考过程在产出结论后自动折叠
 * - autoCollapseToolCards：工具执行卡跟随本轮输出状态——输出期间保持展开，
 *   流结束后与思考过程一并折叠收起，只展示最终结果
 *   （执行失败的卡片始终展开，不受此开关影响）
 */
export interface InteractionSettings {
  autoCollapseThought: boolean;
  autoCollapseToolCards: boolean;
}

/** 持久化 JSON 的顶层结构 */
interface StoredInteractionSettings {
  version: number;
  settings: Record<string, unknown>;
}

/** 最小 storage 适配接口：与 Web Storage 对齐，node 测试可注入内存实现 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** v1 默认值（单一事实来源，reset 与容错回退共用） */
export function defaultInteractionSettings(): InteractionSettings {
  return {
    autoCollapseThought: true,
    autoCollapseToolCards: true,
  };
}

/**
 * 将未知来源数据合并进默认值：仅接受与默认值类型一致的已知字段，
 * 旧版本缺字段、多余字段、类型不符字段一律回退默认（不得抛异常）。
 */
export function mergeInteractionSettings(raw: unknown): InteractionSettings {
  const defaults = defaultInteractionSettings();
  if (raw === null || typeof raw !== "object") return defaults;
  const source = raw as Record<string, unknown>;
  const merged: InteractionSettings = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof InteractionSettings)[]) {
    const value = source[key];
    if (typeof value === typeof defaults[key]) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/**
 * 从 storage 读取设置；JSON 损坏 / 结构不符 / storage 不可用（隐私模式抛异常等）
 * 一律回退默认值，绝不抛异常。
 */
export function loadInteractionSettings(storage?: StorageLike): InteractionSettings {
  if (!storage) return defaultInteractionSettings();
  try {
    const text = storage.getItem(INTERACTION_SETTINGS_STORAGE_KEY);
    if (!text) return defaultInteractionSettings();
    const parsed = JSON.parse(text) as Partial<StoredInteractionSettings> | unknown;
    if (parsed === null || typeof parsed !== "object") return defaultInteractionSettings();
    return mergeInteractionSettings((parsed as StoredInteractionSettings).settings);
  } catch {
    return defaultInteractionSettings();
  }
}

/** 写入设置（带 version 包装）；storage 写入失败时静默降级为仅内存态 */
export function saveInteractionSettings(
  settings: InteractionSettings,
  storage?: StorageLike
): void {
  if (!storage) return;
  try {
    const payload: StoredInteractionSettings = {
      version: INTERACTION_SETTINGS_VERSION,
      settings: { ...settings },
    };
    storage.setItem(INTERACTION_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 持久化失败不影响运行态
  }
}

function resolveDefaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export interface InteractionSettingsStore {
  settings: Ref<InteractionSettings>;
  updateSetting<K extends keyof InteractionSettings>(
    key: K,
    value: InteractionSettings[K]
  ): void;
  resetToDefaults(): void;
}

/** 工厂：创建一个独立的设置 store（加载 → watch 持久化），可注入 storage 便于测试 */
export function createInteractionSettingsStore(storage?: StorageLike): InteractionSettingsStore {
  const settings = ref<InteractionSettings>(loadInteractionSettings(storage));

  watch(
    settings,
    (value) => {
      saveInteractionSettings(value, storage);
    },
    { deep: true }
  );

  function updateSetting<K extends keyof InteractionSettings>(
    key: K,
    value: InteractionSettings[K]
  ) {
    settings.value = { ...settings.value, [key]: value };
  }

  function resetToDefaults() {
    settings.value = defaultInteractionSettings();
  }

  return { settings, updateSetting, resetToDefaults };
}

/** 模块级单例（ref 共享）：Console 内多处消费同一份设置 */
let singleton: InteractionSettingsStore | null = null;

export function useInteractionSettings(): InteractionSettingsStore {
  if (!singleton) {
    singleton = createInteractionSettingsStore(resolveDefaultStorage());
  }
  return singleton;
}
