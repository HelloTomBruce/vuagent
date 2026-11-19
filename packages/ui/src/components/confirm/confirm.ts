import { reactive } from "vue";
import type {
  ConfirmItem,
  ConfirmOptions,
  ConfirmState,
  ConfirmTone,
  VaConfirm,
} from "./types";

/**
 * 全局确认 store（形态同 toaster/store.ts）：
 *   - 任意位置 await vaConfirm(options)，宿主 <VaConfirmHost /> 负责渲染；
 *   - 队列串行：并发确认不互相覆盖，前一个 settle 后宿主才展示下一个；
 *   - Promise 的 resolve 保存在模块级 Map（不进 reactive，避免被代理包裹）；
 *   - 无宿主时 fail-closed：开发期警告 + 立即 resolve(false)，不会挂死调用方。
 */

const state = reactive<ConfirmState>({ queue: [], details: null });

interface PendingConfirm {
  resolve: (ok: boolean) => void;
}

const pending = new Map<number, PendingConfirm>();
let uid = 0;
/** 已挂载宿主数（SSR / 未挂载为 0） */
let hostCount = 0;
/** 无宿主警告只报一次，宿主注册后重置（热更新后仍能提示） */
let warnedNoHost = false;

const DEFAULT_CONFIRM_TEXT = "确认";
const DEFAULT_CANCEL_TEXT = "取消";

/** 开发期判定：非 Vite 环境（import.meta.env 缺失）回落为 true，宁可多提示 */
function isDev(): boolean {
  try {
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
    return env?.DEV ?? true;
  } catch {
    return true;
  }
}

function normalize(options: ConfirmOptions): ConfirmItem {
  const tone: ConfirmTone = options.tone ?? "default";
  return {
    id: ++uid,
    title: options.title,
    description: options.description,
    tone,
    confirmText: options.confirmText ?? DEFAULT_CONFIRM_TEXT,
    cancelText: options.cancelText ?? DEFAULT_CANCEL_TEXT,
    icon: options.icon ?? false,
    requireText: options.requireText,
    checkboxLabel: options.checkboxLabel,
  };
}

/** 请求确认（命令式入口，返回 Promise<boolean>） */
function openConfirm(options: ConfirmOptions): Promise<boolean> {
  if (hostCount === 0) {
    if (isDev() && !warnedNoHost) {
      warnedNoHost = true;
      console.warn(
        "[VaConfirm] 未找到已挂载的 <VaConfirmHost />：vaConfirm() 将直接 resolve(false)。请在应用根节点挂载宿主组件。",
      );
    }
    state.details = { ok: false, checked: false };
    return Promise.resolve(false);
  }
  const item = normalize(options);
  const promise = new Promise<boolean>((resolve) => {
    pending.set(item.id, { resolve });
  });
  // 先登记 Promise 再入队：宿主同步渲染队首时一定拿得到 resolve
  state.queue.push(item);
  return promise;
}

/**
 * 结单（宿主内部使用）：resolve Promise、记录 details、出队。
 * 幂等——重复 settle 同一 id 直接忽略。
 */
export function settleConfirm(id: number, ok: boolean, checked = false): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  state.details = { ok, checked };
  const index = state.queue.findIndex((item) => item.id === id);
  if (index >= 0) state.queue.splice(index, 1);
  entry.resolve(ok);
}

/** 关闭全部待确认项（均 resolve false）；当前弹窗由宿主在队列清空后播放退出动画 */
function closeAll(): void {
  for (const item of [...state.queue]) settleConfirm(item.id, false, false);
}

function registerConfirmHost(): void {
  hostCount += 1;
  warnedNoHost = false;
}

function unregisterConfirmHost(): void {
  hostCount = Math.max(0, hostCount - 1);
}

const api = Object.assign(openConfirm, { state, closeAll });
Object.defineProperty(api, "details", {
  get: () => state.details,
  enumerable: true,
});

export const vaConfirm = api as VaConfirm;

/** 组合式别名，与 vaConfirm 等价 */
export function useConfirm(): VaConfirm {
  return vaConfirm;
}

export { registerConfirmHost, unregisterConfirmHost };
