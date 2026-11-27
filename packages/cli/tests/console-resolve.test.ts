/**
 * console 目录解析（评审 R3 回归）：
 * `require.resolve` 在 Windows 返回反斜杠路径，早期用 `/\/index\.html$/` 正则替换，
 * 在 Windows 上不匹配 → 目录指向 index.html 文件本身 → 服务启动即报「缺少 SPA 入口」。
 * 现在统一走 path.dirname，两种路径风格都要正确。
 */
import { describe, it, expect } from "vitest";
import { dirFromHtmlEntry, resolveConsoleDir } from "../src/lib/console-resolve.js";

describe("dirFromHtmlEntry", () => {
  it("POSIX 路径：取 dist 目录", () => {
    expect(dirFromHtmlEntry("/usr/lib/node_modules/@vuagent/console/dist/index.html")).toBe(
      "/usr/lib/node_modules/@vuagent/console/dist",
    );
  });

  it("Windows 路径（反斜杠）：同样取 dist 目录（R3：正则替换会在这里失效）", () => {
    const dir = dirFromHtmlEntry("C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@vuagent\\console\\dist\\index.html");
    expect(dir.endsWith("dist")).toBe(true);
    expect(dir.includes("index.html")).toBe(false);
    // 注：不能用宿主 path.basename 断言——POSIX 的 path 不识别反斜杠（会返回整串）
    expect(dir).toBe("C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@vuagent\\console\\dist");
  });
});

describe("resolveConsoleDir 优先级", () => {
  it("flag > env > package > none", () => {
    expect(resolveConsoleDir({ consoleDir: "/flag/dir" })).toEqual({ dir: "/flag/dir", source: "flag" });
    expect(resolveConsoleDir({ env: { VUAGENT_CONSOLE_DIR: "/env/dir" } })).toEqual({
      dir: "/env/dir",
      source: "env:VUAGENT_CONSOLE_DIR",
    });
    expect(resolveConsoleDir({ env: {}, resolvePackage: () => "/pkg/dist" })).toEqual({
      dir: "/pkg/dist",
      source: "package",
    });
    expect(resolveConsoleDir({ env: {}, resolvePackage: () => null })).toEqual({ dir: null, source: "none" });
  });
});
