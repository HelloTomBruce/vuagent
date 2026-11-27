/**
 * 命令式文本输入（askText）——替代原生 prompt()。
 * 形态对齐 @vuagent/ui 的 vaConfirm store 模式：
 *   - 任意位置 await askText(options) → Promise<string | null>（null = 取消/空输入）；
 *   - 宿主 <TextPromptHost /> 负责渲染（基于 VaDialog，Esc=取消）；
 *   - 单待决项：重复 askText 以最后一次为准（console 场景无并发输入需求）；
 *   - 无宿主时 fail-closed：开发期警告 + resolve(null)，不挂死调用方。
 */
import { reactive } from "vue";

export interface TextPromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  /** 预填值 */
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
}

interface TextPromptState {
  open: boolean;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  confirmText: string;
  cancelText: string;
}

const state = reactive<TextPromptState>({
  open: false,
  title: "",
  description: "",
  placeholder: "",
  value: "",
  confirmText: "确认",
  cancelText: "取消",
});

let pendingResolve: ((v: string | null) => void) | null = null;
let hostCount = 0;
let warnedNoHost = false;

/** 开发期判定（同 vaConfirm.isDev）：非 Vite 环境回落 true，宁可多提示 */
function isDev(): boolean {
  try {
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
    return env?.DEV ?? true;
  } catch {
    return true;
  }
}

/** 宿主挂载/卸载登记（Console 挂一次 <TextPromptHost />） */
export function registerTextPromptHost(): () => void {
  hostCount += 1;
  return () => {
    hostCount -= 1;
  };
}

/** 宿主读取状态用 */
export function useTextPromptState(): TextPromptState {
  return state;
}

/** 命令式入口：resolve 输入文本；取消 / 空输入 / 无宿主 → null */
export function askText(options: TextPromptOptions): Promise<string | null> {
  if (hostCount === 0) {
    if (isDev() && !warnedNoHost) {
      warnedNoHost = true;
      console.warn(
        "[askText] 未找到已挂载的 <TextPromptHost />：askText() 将直接 resolve(null)。请在应用根节点挂载宿主组件。",
      );
    }
    return Promise.resolve(null);
  }
  state.title = options.title;
  state.description = options.description ?? "";
  state.placeholder = options.placeholder ?? "";
  state.value = options.initialValue ?? "";
  state.confirmText = options.confirmText ?? "确认";
  state.cancelText = options.cancelText ?? "取消";
  state.open = true;
  // 单待决项语义：重入时先以「取消」结算上一个 Promise，避免其永久悬空
  if (pendingResolve) pendingResolve(null);
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

/** 确认：空输入视作取消（路径类输入空值无意义，与原生 prompt 的 "" 语义刻意不同） */
export function submitTextPrompt() {
  if (!state.open) return;
  const value = state.value.trim();
  settle(value || null);
}

/** 取消（Esc / 遮罩 / 取消按钮） */
export function cancelTextPrompt() {
  if (!state.open) return;
  settle(null);
}

function settle(value: string | null) {
  state.open = false;
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(value);
}
