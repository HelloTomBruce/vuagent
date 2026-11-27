/**
 * 数据路径解析（0.7.0 CLI 数据目录规范，docs/design/cli-data-dir-architecture.md §4）。
 *
 * 解析优先级（单一事实源，CLI 与直接 `node dist/index.js` 共用）：
 *   1. --data-dir <path>        显式目录（flag）
 *   2. $VUAGENT_HOME            显式目录（CI / 容器 / 共享卷）
 *   3. 平台默认：macOS/Linux `~/.vuagent`；Windows `%LOCALAPPDATA%\vuagent`（缺省回退 ~/.vuagent）
 *   4. --db <path> / $DB_PATH   只覆盖「库文件」，数据根的其余派生路径不受影响
 *
 * 每条路径都带 source（flag / env:VUAGENT_HOME / default / env:DB_PATH / flag:db），
 * `vuagent paths` 原样打印，根除「配了但没生效」。
 * 不再有 CWD 相对路径：库、计价表、日志、锁、导出、临时目录全部由数据根派生。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type DataPathSource = "flag" | "flag:db" | "env:VUAGENT_HOME" | "env:DB_PATH" | "default";

export interface SourcedPath {
  path: string;
  source: DataPathSource;
}

export interface DataPaths {
  /** 数据根（0700）；其下派生路径的 source 与数据根一致 */
  dataDir: SourcedPath;
  /** SQLite 库文件（可能被 --db / DB_PATH 单独覆盖，此时 source 独立标注） */
  dbPath: SourcedPath;
  /** 计价表（缺省空表 = 只记量不记钱） */
  pricingPath: SourcedPath;
  logsDir: string;
  logFile: string;
  exportsDir: string;
  runDir: string;
  lockFile: string;
  tmpDir: string;
}

export interface ResolveDataPathsOptions {
  /** --data-dir */
  dataDir?: string;
  /** --db（仅覆盖库文件；":memory:" 原样保留，不做路径解析） */
  dbPath?: string;
  /** 可注入环境（测试）；缺省 process.env */
  env?: NodeJS.ProcessEnv;
  /** 可注入平台（测试 Windows 分支）；缺省 process.platform */
  platform?: NodeJS.Platform;
  /** 可注入 home（测试）；缺省 os.homedir() */
  homeDir?: string;
  /** 相对路径的解析基准（测试）；缺省 process.cwd() */
  cwd?: string;
}

/** 用户级默认数据根：Windows 走 LOCALAPPDATA，其余 ~/.vuagent */
export function defaultDataDir(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): string {
  if (platform === "win32") {
    const localAppData = (env.LOCALAPPDATA || "").trim();
    if (localAppData) return path.join(localAppData, "vuagent");
  }
  return path.join(homeDir, ".vuagent");
}

export function resolveDataPaths(options: ResolveDataPathsOptions = {}): DataPaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();

  // 数据根：flag > VUAGENT_HOME > 平台默认
  let dataDir: SourcedPath;
  if (options.dataDir?.trim()) {
    dataDir = { path: path.resolve(cwd, options.dataDir.trim()), source: "flag" };
  } else if (env.VUAGENT_HOME?.trim()) {
    dataDir = { path: path.resolve(cwd, env.VUAGENT_HOME.trim()), source: "env:VUAGENT_HOME" };
  } else {
    dataDir = { path: defaultDataDir(platform, homeDir, env), source: "default" };
  }

  // 库文件：--db > DB_PATH > 数据根派生（派生时继承数据根的 source）
  let dbPath: SourcedPath;
  if (options.dbPath?.trim()) {
    const raw = options.dbPath.trim();
    dbPath = { path: raw === ":memory:" ? raw : path.resolve(cwd, raw), source: "flag:db" };
  } else if (env.DB_PATH?.trim()) {
    const raw = env.DB_PATH.trim();
    dbPath = { path: raw === ":memory:" ? raw : path.resolve(cwd, raw), source: "env:DB_PATH" };
  } else {
    dbPath = { path: path.join(dataDir.path, "harness.db"), source: dataDir.source };
  }

  const root = dataDir.path;
  return {
    dataDir,
    dbPath,
    pricingPath: { path: path.join(root, "config", "model-pricing.json"), source: dataDir.source },
    logsDir: path.join(root, "logs"),
    logFile: path.join(root, "logs", "harness.log"),
    exportsDir: path.join(root, "exports"),
    runDir: path.join(root, "run"),
    lockFile: path.join(root, "run", "harness.lock"),
    tmpDir: path.join(root, "tmp"),
  };
}

/**
 * 首启建目录：递归创建数据根及全部派生目录（POSIX 0700，Windows 忽略 mode）。
 * 幂等，重复调用无副作用；权限收紧（已存在目录的 chmod）由 doctor 报告，不自动动用户目录。
 */
export function ensureDataDirs(paths: DataPaths, platform: NodeJS.Platform = process.platform): void {
  const mode = platform === "win32" ? undefined : 0o700;
  for (const dir of [paths.dataDir.path, path.dirname(paths.pricingPath.path), paths.logsDir, paths.exportsDir, paths.runDir, paths.tmpDir]) {
    fs.mkdirSync(dir, { recursive: true, ...(mode !== undefined ? { mode } : {}) });
  }
}
