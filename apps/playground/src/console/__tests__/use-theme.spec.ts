// @vitest-environment happy-dom
/**
 * useTheme（宿主主题三态切换）单元测试
 * 覆盖：默认跟随系统、持久化偏好恢复、坏值回退、setPreference 持久化 + DOM 同步、
 * system 态 matchMedia change 实时跟随、非 system 态不受系统切换影响、DOM 同步
 * （data-theme + color-scheme）。matchMedia 用可控假实现注入，storage 用内存实现。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  createThemeStore,
} from "../composables/useTheme";

/** 可控 matchMedia 假实现：记录监听器，手动翻转 matches 并派发 change */
function makeMedia(initialMatches: boolean) {
  const listeners: Array<() => void> = [];
  return {
    matches: initialMatches,
    addEventListener(type: string, cb: () => void) {
      if (type === "change") listeners.push(cb);
    },
    /** 翻转系统偏好并通知监听者（模拟用户改系统主题） */
    flip() {
      this.matches = !this.matches;
      for (const cb of listeners) cb();
    },
  };
}

type Media = ReturnType<typeof makeMedia>;

/** 内存 storage 假实现（只需 getItem/setItem 结构） */
function makeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  } as Storage;
}

/** 创建 store 的统一入口：注入假 matchMedia，返回 media 便于手动翻转 */
function mount(media: Media, storage: Storage = makeStorage()) {
  vi.stubGlobal("matchMedia", () => media);
  const store = createThemeStore(storage);
  return { store, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTheme", () => {
  it("无持久化值默认 system：解析 matchMedia(false) → light，同步 DOM", () => {
    const media = makeMedia(false);
    const { store } = mount(media);

    expect(store.preference.value).toBe("system");
    expect(store.resolved.value).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("system 态 + matchMedia(true) → dark（首帧即暗色的宿主侧等价行为）", () => {
    const { store } = mount(makeMedia(true));

    expect(store.preference.value).toBe("system");
    expect(store.resolved.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("已持久化 dark 偏好优先于系统偏好（手动覆盖 system）", () => {
    const { store } = mount(makeMedia(false), makeStorage({ [THEME_STORAGE_KEY]: "dark" }));

    expect(store.preference.value).toBe("dark");
    expect(store.resolved.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("持久化坏值回退 system，不抛异常", () => {
    const { store } = mount(makeMedia(false), makeStorage({ [THEME_STORAGE_KEY]: "sepia" }));

    expect(store.preference.value).toBe("system");
    expect(store.resolved.value).toBe("light");
  });

  it("setPreference 写 DOM 并持久化到 storage", () => {
    const media = makeMedia(false);
    const { store, storage } = mount(media);

    store.setPreference("dark");
    expect(store.preference.value).toBe("dark");
    expect(store.resolved.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // 亮暗切换实时生效
    store.setPreference("light");
    expect(store.resolved.value).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("system 态监听 matchMedia change：系统切换实时跟随", () => {
    const media = makeMedia(false);
    const { store } = mount(media);

    expect(store.resolved.value).toBe("light");
    media.flip(); // 系统 → dark
    expect(store.resolved.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    media.flip(); // 系统 → light
    expect(store.resolved.value).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("手动 dark 态不受系统切换影响（覆盖语义）", () => {
    const media = makeMedia(false);
    const { store } = mount(media);

    store.setPreference("dark");
    media.flip(); // 系统切到 light
    expect(store.resolved.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("storage 抛异常时优雅降级为内存态（隐私模式）", () => {
    const media = makeMedia(false);
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    vi.stubGlobal("matchMedia", () => media);
    const store = createThemeStore(throwing);

    store.setPreference("dark"); // 写入失败但不阻断运行态
    expect(store.resolved.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("FOUC 内联脚本与 useTheme 解析规则一致（防漂移守卫）", () => {
    // index.html 内联脚本与 useTheme.ts 是同一规则的两份实现，
    // 任一侧单改（key/白名单/回退）都会造成首帧主题与运行态分叉——在此锁死。
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    for (const pref of ["light", "dark", "system"]) {
      expect(html).toContain(`"${pref}"`);
    }
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("dataset.theme");
    expect(html).toContain("colorScheme");
  });
});
