/**
 * useInteractionSettings 数据层单测（TASK-015）
 * 覆盖：默认值、持久化往返、损坏 JSON 回退、旧版本缺字段合并、reset
 */
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
  createInteractionSettingsStore,
  defaultInteractionSettings,
  INTERACTION_SETTINGS_STORAGE_KEY,
  INTERACTION_SETTINGS_VERSION,
  loadInteractionSettings,
  mergeInteractionSettings,
  saveInteractionSettings,
  type StorageLike,
} from "../composables/useInteractionSettings";

/** 内存 storage 适配器（node 环境注入用） */
function createMemoryStorage(initial?: Record<string, string>): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("defaultInteractionSettings", () => {
  it("v1 默认值：自动折叠开关与侧栏分区显隐均为 true", () => {
    expect(defaultInteractionSettings()).toEqual({
      autoCollapseThought: true,
      autoCollapseToolCards: true,
      showApprovals: true,
      showFileTree: true,
    });
  });
});

describe("loadInteractionSettings", () => {
  it("无存储记录时返回默认值", () => {
    expect(loadInteractionSettings(createMemoryStorage())).toEqual(
      defaultInteractionSettings()
    );
  });

  it("JSON 损坏时回退默认值且不抛异常", () => {
    const storage = createMemoryStorage({
      [INTERACTION_SETTINGS_STORAGE_KEY]: "{not-valid-json",
    });
    expect(() => loadInteractionSettings(storage)).not.toThrow();
    expect(loadInteractionSettings(storage)).toEqual(defaultInteractionSettings());
  });

  it("顶层结构非对象时回退默认值", () => {
    const storage = createMemoryStorage({
      [INTERACTION_SETTINGS_STORAGE_KEY]: JSON.stringify("oops"),
    });
    expect(loadInteractionSettings(storage)).toEqual(defaultInteractionSettings());
  });

  it("旧版本缺字段：已知字段保留，缺失字段合并默认值", () => {
    const storage = createMemoryStorage({
      [INTERACTION_SETTINGS_STORAGE_KEY]: JSON.stringify({
        version: 0,
        settings: { autoCollapseThought: false },
      }),
    });
    expect(loadInteractionSettings(storage)).toEqual({
      autoCollapseThought: false,
      autoCollapseToolCards: true, // 缺字段回退默认
      showApprovals: true,
      showFileTree: true,
    });
  });

  it("多余字段被忽略、类型不符字段回退默认", () => {
    const merged = mergeInteractionSettings({
      autoCollapseThought: "yes", // 类型不符
      autoCollapseToolCards: false,
      unknownFutureFlag: 123, // 未知字段
    });
    expect(merged).toEqual({
      autoCollapseThought: true,
      autoCollapseToolCards: false,
      showApprovals: true,
      showFileTree: true,
    });
    expect("unknownFutureFlag" in merged).toBe(false);
  });

  it("storage 不可用（缺省参数）时返回默认值", () => {
    expect(loadInteractionSettings()).toEqual(defaultInteractionSettings());
  });
});

describe("saveInteractionSettings", () => {
  it("持久化 JSON 含 version 字段", () => {
    const storage = createMemoryStorage();
    saveInteractionSettings(
      { autoCollapseThought: false, autoCollapseToolCards: true, showApprovals: false, showFileTree: true },
      storage
    );
    const raw = storage.data.get(INTERACTION_SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(INTERACTION_SETTINGS_VERSION);
    expect(parsed.settings).toEqual({
      autoCollapseThought: false,
      autoCollapseToolCards: true,
      showApprovals: false,
      showFileTree: true,
    });
  });

  it("持久化往返：save 后 load 得到相同设置", () => {
    const storage = createMemoryStorage();
    const value = { autoCollapseThought: false, autoCollapseToolCards: false, showApprovals: true, showFileTree: false };
    saveInteractionSettings(value, storage);
    expect(loadInteractionSettings(storage)).toEqual(value);
  });
});

describe("createInteractionSettingsStore", () => {
  it("创建时从 storage 加载已有设置", () => {
    const storage = createMemoryStorage({
      [INTERACTION_SETTINGS_STORAGE_KEY]: JSON.stringify({
        version: INTERACTION_SETTINGS_VERSION,
        settings: { autoCollapseThought: false, autoCollapseToolCards: true },
      }),
    });
    const store = createInteractionSettingsStore(storage);
    expect(store.settings.value.autoCollapseThought).toBe(false);
  });

  it("updateSetting 变更后自动持久化到 storage", async () => {
    const storage = createMemoryStorage();
    const store = createInteractionSettingsStore(storage);
    store.updateSetting("autoCollapseToolCards", false);
    await nextTick();
    expect(loadInteractionSettings(storage)).toEqual({
      autoCollapseThought: true,
      autoCollapseToolCards: false,
      showApprovals: true,
      showFileTree: true,
    });
  });

  it("resetToDefaults 恢复默认并持久化", async () => {
    const storage = createMemoryStorage();
    const store = createInteractionSettingsStore(storage);
    store.updateSetting("autoCollapseThought", false);
    await nextTick();
    store.resetToDefaults();
    expect(store.settings.value).toEqual(defaultInteractionSettings());
    await nextTick();
    expect(loadInteractionSettings(storage)).toEqual(defaultInteractionSettings());
  });
});
