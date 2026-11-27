/**
 * console 静态资源目录解析（0.7.0 设计 §6）：
 *   --console-dir > VUAGENT_CONSOLE_DIR > @vuagent/console 包（结构抽取 T16 后的发布形态）
 * 找不到时返回 null（API-only 降级，CLI 打印提示而不是报错——服务仍可用）。
 */
import { createRequire } from "node:module";
import path from "node:path";

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

/**
 * entry HTML 路径 → 目录（跨平台；评审 R3 回归点：不要用只匹配 "/" 的正则）。
 * 按路径自身的分隔符选择规则，而不是宿主平台：这样 Windows 产物在 POSIX 上做
 * 静态校验（CI 交叉检查、测试）也能得到正确目录。代价是「目录名里带字面反斜杠」
 * 的极端 POSIX 路径会被误判为 Windows 路径——这类路径在实践中不存在。
 */
export function dirFromHtmlEntry(entry: string): string {
  const impl = entry.includes("\\") || /^[A-Za-z]:/.test(entry) ? path.win32 : path.posix;
  return impl.dirname(entry);
}

/** 发布形态：@vuagent/console 随 CLI 一起安装，取其 dist 目录 */
function resolveConsolePackage(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return dirFromHtmlEntry(require.resolve("@vuagent/console/dist/index.html"));
  } catch {
    return null;
  }
}
