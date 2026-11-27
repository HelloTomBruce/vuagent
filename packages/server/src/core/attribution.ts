/**
 * 出站请求的产品身份（User-Agent）。
 *
 * 口径参考 DSH 的 `attributionHeaders()`：每个供应商请求都带一个稳定的产品标识，
 * 便于网关侧识别来源、也便于用户排障时对账。
 *
 * 取值来源优先级（见 `endpoint-headers.ts` 的 `attributionHeadersForRequest`）：
 *   1. `VUAGENT_USER_AGENT`（整串覆盖，用户明确指定时以用户为准）
 *   2. `VUAGENT_USER_AGENT_SUFFIX`（在默认串后追加）
 *   3. 默认 `vuagent/<version> (+repo)`
 *
 * 版本号取自本包 package.json（打包后仍可解析），避免与发布版本漂移。
 */
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

/** 仓库地址（归属头与网关来源头共用，避免两处硬编码漂移） */
export const REPO_URL = "https://github.com/HelloTomBruce/vuagent";

/**
 * 版本解析：从**候选路径**逐个找本包 manifest，并校验 `name` 对得上。
 *
 * 0.7.1 的实现只试了 `../package.json`——在 `src/core/` 与 `dist/core/` 下都指向
 * 不存在的文件，于是静默回落 `0.0.0`，归属头常年发 `vuagent/0.0.0`（评审 C2）。
 * 现在两种布局都覆盖，且校验包名，避免误读上层的别的 manifest。
 */
function readVersion(): string {
  // src/core/* → src/package.json（无）→ 包根；dist/core/* → dist/package.json（无）→ 包根
  for (const candidate of ["../package.json", "../../package.json"]) {
    try {
      const pkg = require_(candidate) as { name?: string; version?: string };
      if (pkg?.name === "@vuagent/server" && typeof pkg.version === "string" && pkg.version) {
        return pkg.version;
      }
    } catch {
      // 该候选不存在，试下一个
    }
  }
  // 找不到不是致命错误（例如被整体内联进别的产物），但要留下痕迹而不是静默 0.0.0
  console.warn("[vuagent] 无法从包 manifest 解析版本号，User-Agent 将使用 0.0.0");
  return "0.0.0";
}

const VERSION = readVersion();

/** 产品标识：`vuagent/<version> (+repo)` */
export const PRODUCT_UA = `vuagent/${VERSION} (+${REPO_URL})`;
