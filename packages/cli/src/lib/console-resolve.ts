/**
 * console 静态资源目录解析（0.7.0 设计 §6）：
 *   --console-dir > VUAGENT_CONSOLE_DIR > @vuagent/console 包（结构抽取 T16 后的发布形态）
 * 找不到时返回 null（API-only 降级，CLI 打印提示而不是报错——服务仍可用）。
 */
import { createRequire } from "node:module";

export interface ConsoleDirResolution {
  dir: string | null;
  source: "flag" | "env:VUAGENT_CONSOLE_DIR" | "package" | "none";
}

export function resolveConsoleDir(options: {
  consoleDir?: string;
  env?: NodeJS.ProcessEnv;
  /** 可注入（测试）；缺省按本包 node_modules 解析 @vuagent/console */
  resolvePackage?: () => string | null;
}): ConsoleDirResolution {
  if (options.consoleDir?.trim()) {
    return { dir: options.consoleDir.trim(), source: "flag" };
  }
  const envDir = options.env?.VUAGENT_CONSOLE_DIR?.trim();
  if (envDir) {
    return { dir: envDir, source: "env:VUAGENT_CONSOLE_DIR" };
  }
  const fromPackage = options.resolvePackage ? options.resolvePackage() : resolveConsolePackage();
  if (fromPackage) {
    return { dir: fromPackage, source: "package" };
  }
  return { dir: null, source: "none" };
}

/** 发布形态：@vuagent/console 随 CLI 一起安装，取其 dist 目录 */
function resolveConsolePackage(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@vuagent/console/dist/index.html");
    return entry.replace(/\/index\.html$/, "");
  } catch {
    return null;
  }
}
