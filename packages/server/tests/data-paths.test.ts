/**
 * resolveDataPaths 单测（T01）：
 * 解析优先级 flag > VUAGENT_HOME > 平台默认；--db/DB_PATH 只覆盖库文件；
 * Windows 走 LOCALAPPDATA；每条路径带 source；ensureDataDirs 幂等建目录。
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDataPaths, ensureDataDirs, defaultDataDir } from "../src/storage/paths.js";

const HOME = path.join(os.tmpdir(), "vuagent-home-fake");
const CWD = path.join(os.tmpdir(), "vuagent-cwd-fake");

function resolve(opts: Parameters<typeof resolveDataPaths>[0]) {
  return resolveDataPaths({ homeDir: HOME, cwd: CWD, env: {}, ...opts });
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("resolveDataPaths", () => {
  it("默认：POSIX 走 <home>/.vuagent，source=default", () => {
    const p = resolve({ platform: "darwin" });
    expect(p.dataDir).toEqual({ path: path.join(HOME, ".vuagent"), source: "default" });
    expect(p.dbPath.path).toBe(path.join(HOME, ".vuagent", "harness.db"));
    expect(p.dbPath.source).toBe("default");
    expect(p.pricingPath.path).toBe(path.join(HOME, ".vuagent", "config", "model-pricing.json"));
    expect(p.lockFile).toBe(path.join(HOME, ".vuagent", "run", "harness.lock"));
    expect(p.logFile).toBe(path.join(HOME, ".vuagent", "logs", "harness.log"));
  });

  it("Windows：LOCALAPPDATA 优先，缺省回退 ~/.vuagent", () => {
    expect(defaultDataDir("win32", HOME, { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" })).toBe(
      path.join("C:\\Users\\u\\AppData\\Local", "vuagent")
    );
    expect(defaultDataDir("win32", HOME, {})).toBe(path.join(HOME, ".vuagent"));
    expect(defaultDataDir("linux", HOME, { LOCALAPPDATA: "C:\\x" })).toBe(path.join(HOME, ".vuagent"));
  });

  it("--data-dir 最高优先（flag），相对路径按 cwd 解析", () => {
    const p = resolve({ dataDir: "./my-data", env: { VUAGENT_HOME: "/env-home" } });
    expect(p.dataDir).toEqual({ path: path.join(CWD, "my-data"), source: "flag" });
    // 派生路径继承数据根 source
    expect(p.dbPath.source).toBe("flag");
    expect(p.pricingPath.source).toBe("flag");
  });

  it("VUAGENT_HOME 次优先（env:VUAGENT_HOME）", () => {
    const p = resolve({ env: { VUAGENT_HOME: "relative-home" } });
    expect(p.dataDir).toEqual({ path: path.join(CWD, "relative-home"), source: "env:VUAGENT_HOME" });
  });

  it("--db 只覆盖库文件，数据根其余派生路径不受影响", () => {
    const p = resolve({ dataDir: "/data/root", dbPath: "/elsewhere/custom.db" });
    expect(p.dbPath).toEqual({ path: "/elsewhere/custom.db", source: "flag:db" });
    expect(p.dataDir.path).toBe("/data/root");
    expect(p.lockFile).toBe(path.join("/data/root", "run", "harness.lock"));
    expect(p.pricingPath.path).toBe(path.join("/data/root", "config", "model-pricing.json"));
  });

  it("DB_PATH 只覆盖库文件（env:DB_PATH），且 --db 优先于 DB_PATH", () => {
    const p1 = resolve({ env: { DB_PATH: "./local.db" } });
    expect(p1.dbPath).toEqual({ path: path.join(CWD, "local.db"), source: "env:DB_PATH" });
    expect(p1.dataDir.source).toBe("default");

    const p2 = resolve({ dbPath: "/flag.db", env: { DB_PATH: "/env.db" } });
    expect(p2.dbPath).toEqual({ path: "/flag.db", source: "flag:db" });
  });

  it("--db :memory: 原样保留（测试/试跑场景），不做路径解析", () => {
    const p = resolve({ dbPath: ":memory:" });
    expect(p.dbPath).toEqual({ path: ":memory:", source: "flag:db" });
  });

  it("不再产生 CWD 相对路径：所有返回均为绝对路径", () => {
    const p = resolve({ platform: "linux" });
    for (const sp of [p.dataDir, p.dbPath, p.pricingPath]) {
      expect(path.isAbsolute(sp.path)).toBe(true);
    }
    for (const abs of [p.logsDir, p.logFile, p.exportsDir, p.runDir, p.lockFile, p.tmpDir]) {
      expect(path.isAbsolute(abs)).toBe(true);
    }
  });
});

describe("ensureDataDirs", () => {
  it("递归创建数据根与全部派生目录，幂等", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-paths-"));
    tempDirs.push(root);
    const dataDir = path.join(root, "data");
    const p = resolve({ dataDir });
    ensureDataDirs(p);
    ensureDataDirs(p); // 幂等
    for (const dir of [dataDir, path.dirname(p.pricingPath.path), p.logsDir, p.exportsDir, p.runDir, p.tmpDir]) {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
    if (process.platform !== "win32") {
      expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
    }
  });
});
