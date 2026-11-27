/** 打开浏览器（best-effort，失败静默——headless/CI 里 xdg-open 缺席是常态） */
import { spawn } from "node:child_process";

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // 打不开浏览器不阻断服务
  }
}

/** 是否该自动开浏览器：--no-open 优先；CI / 无 TTY 自动关（SSH/容器里开了也没人看） */
export function shouldAutoOpen(options: { noOpen?: boolean; env?: NodeJS.ProcessEnv; isTTY?: boolean }): boolean {
  if (options.noOpen) return false;
  const env = options.env ?? process.env;
  if (env.CI) return false;
  if (options.isTTY === false) return false;
  return true;
}
