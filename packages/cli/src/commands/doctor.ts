/**
 * vuagent doctor —— 数据目录与运行环境体检（M3/T14）。
 *
 * 检查面：node:sqlite 可用性、数据目录与权限、库完整性与体积、WAL 阈值（>32MB 提示
 * backup）、top sessions by size + 最大 turn 行（W2 性能指标）、单实例锁状态、端口占用、
 * 模型凭据、console 资源解析。
 * --fix-lock：清残留锁（用户确认进程已死后的手动兜底，配合提示语）。
 * --json：机器可读输出。退出码：0 = 无 error（warn 不红），1 = 有 error。
 */
import fs from "node:fs";
import net from "node:net";
import type { DataPaths } from "@vuagent/server";
import { loadMcpConfigFile } from "@vuagent/server";
import { forceClearLock, readLock, pidAlive } from "../lib/lock.js";
import { loadSqlite, openDb, turnSizeLeaderboard } from "../lib/db.js";
import { resolveEndpointHeaders } from "@vuagent/server";
import { resolveConsoleDir } from "../lib/console-resolve.js";

export type CheckStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  check: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

const WAL_WARN_BYTES = 32 * 1024 * 1024;

export async function runDoctor(paths: DataPaths, options: { json?: boolean; fixLock?: boolean; port?: number }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (check: string, status: CheckStatus, detail: string, hint?: string) =>
    checks.push({ check, status, detail, hint });

  // ① node:sqlite 可用性（CLI 全部命令的地基）
  try {
    const { DatabaseSync: Probe } = await loadSqlite();
    const mem = new Probe(":memory:");
    const v = (mem.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
    add("node:sqlite", "ok", `可用（SQLite ${v}，node ${process.version}）`);
    mem.close();
  } catch (err) {
    add("node:sqlite", "error", `不可用：${(err as Error).message}`, "升级 Node ≥ 22.13（或 23.4+）");
  }

  // ② 数据目录与权限
  const dataDirExists = fs.existsSync(paths.dataDir.path);
  if (!dataDirExists) {
    add("data-dir", "warn", `不存在：${paths.dataDir.path}（${paths.dataDir.source}）`, "首次 vuagent start 时自动创建");
  } else if (process.platform !== "win32") {
    const mode = fs.statSync(paths.dataDir.path).mode & 0o777;
    if (mode & 0o077) {
      add("data-dir", "warn", `权限过宽：${paths.dataDir.path}（${(mode & 0o777).toString(8).padStart(3, "0")}）`, "建议 chmod 700（doctor 不自动改用户目录权限）");
    } else {
      add("data-dir", "ok", `${paths.dataDir.path}（0700）`);
    }
  } else {
    add("data-dir", "ok", `${paths.dataDir.path}`);
  }

  // ③④⑤ 库完整性 / 体积 / WAL / top sessions（库存在才做）
  const dbFile = paths.dbPath.path;
  const walFile = `${dbFile}-wal`;
  if (dbFile === ":memory:") {
    add("db", "warn", "内存库（--db :memory:）——重启即失忆，不落盘");
  } else if (!fs.existsSync(dbFile)) {
    add("db", "warn", `库不存在：${dbFile}`, "首次 vuagent start 时自动创建");
  } else {
    const dbSize = fs.statSync(dbFile).size;
    try {
      const db = await openDb(dbFile);
      const quick = (db.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
      if (quick === "ok") {
        add("db", "ok", `${dbFile}（${formatBytes(dbSize)}，integrity ok）`);
      } else {
        add("db", "error", `完整性异常：${quick}`, "从最近 backup 恢复，或联系维护者");
      }

      // W2 性能指标：top sessions by size + 最大 turn 行
      const top = turnSizeLeaderboard(db, 3);
      if (top.length > 0) {
        const maxTurn = Math.max(...top.map((t) => t.maxTurnBytes));
        for (const t of top.slice(0, 1)) {
          add(
            "top-session",
            t.bytes > 64 * 1048576 ? "warn" : "ok",
            `最大会话 ${t.sessionId.slice(0, 24)}…：${formatBytes(t.bytes)} / ${t.turns} turns（最大单 turn 行 ${formatBytes(t.maxTurnBytes)}）`,
            t.bytes > 64 * 1048576 ? "瘦身：vuagent prune --older-than 30d --vacuum" : undefined,
          );
        }
        if (maxTurn > 3 * 1024 * 1024) {
          add("turn-row", "warn", `最大单 turn 行 ${formatBytes(maxTurn)}（>3MB 多为拆行前的 legacy 数据）`, "迁移：vuagent migrate --checkpoints --dry-run");
        }
      }
      // 供应商端点 → 解析后的域名规则（用户能看懂「为什么这个端点多带了头」）
      const providerRows = db
        .prepare("SELECT data FROM kv_store WHERE collection = 'providers'")
        .all() as Array<{ data: string }>;
      // 只列有规则命中的供应商 + 一行汇总：20 家供应商全列会把体检报告淹掉
      const ruleRows: string[] = [];
      for (const row of providerRows) {
        let prov: { name?: string; provider?: string; baseUrl?: string };
        try {
          prov = JSON.parse(row.data) as typeof prov;
        } catch {
          continue;
        }
        if (!prov.baseUrl) continue;
        const resolved = resolveEndpointHeaders({
          baseUrl: prov.baseUrl,
          protocol: prov.provider === "anthropic" ? "anthropic" : "openai",
        });
        const applied = resolved.ruleIds.length > 0 ? `注入 ${resolved.ruleIds.join(", ")}` : "";
        const skipped =
          resolved.skippedRuleIds.length > 0 ? `待上下文 ${resolved.skippedRuleIds.join(", ")}` : "";
        const detail = [applied, skipped].filter(Boolean).join("；");
        if (!detail) continue;
        ruleRows.push(`${prov.name ?? "(未命名)"} → ${detail}`);
        if (resolved.notes[0]) add("provider-rule", "ok", `${prov.name ?? "(未命名)"}：${resolved.notes[0]}`);
      }
      if (ruleRows.length > 0) {
        add(
          "provider-rules",
          "ok",
          `${ruleRows.length} 个供应商命中域名规则：${ruleRows.slice(0, 3).join("；")}${
            ruleRows.length > 3 ? ` 等 ${ruleRows.length} 个` : ""
          }`,
        );
      }

      db.close();
    } catch (err) {
      add("db", "error", `无法打开：${(err as Error).message}`);
    }

    // WAL 阈值
    const walSize = fs.existsSync(walFile) ? fs.statSync(walFile).size : 0;
    if (walSize > WAL_WARN_BYTES) {
      add("wal", "warn", `WAL ${formatBytes(walSize)}（>32MB）`, "执行 vuagent backup（顺带 checkpoint 回收空间）");
    } else {
      add("wal", "ok", `${formatBytes(walSize)}`);
    }
  }

  // ⑥ 单实例锁
  if (options.fixLock) {
    const removed = forceClearLock(paths.lockFile);
    add("lock", removed ? "ok" : "ok", removed ? "残留锁已清除" : "无锁可清（--fix-lock 空操作）");
  } else if (fs.existsSync(paths.lockFile)) {
    const holder = readLock(paths.lockFile);
    if (holder && pidAlive(holder.pid)) {
      add("lock", "warn", `持有中：pid ${holder.pid}（端口 ${holder.port}，版本 ${holder.version || "?"}）`, "确认进程已死后清理：vuagent doctor --fix-lock");
    } else {
      add("lock", "warn", "残留锁（持有进程已死或文件损坏）", "清理：vuagent doctor --fix-lock");
    }
  } else {
    add("lock", "ok", "无锁");
  }

  // ⑦ 端口占用（默认端口或 --port 指定值）
  const port = options.port ?? 6880;
  const portBusy = await new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
  });
  if (portBusy) {
    add("port", "warn", `端口 ${port} 已被占用`, "换端口：vuagent --port 0（随机）；或排查占用者");
  } else {
    add("port", "ok", `${port} 可用`);
  }

  // ⑧ 模型凭据
  const hasKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (hasKey) {
    add("credentials", "ok", "环境变量含模型凭据（OPENAI/ANTHROPIC）");
  } else {
    add("credentials", "warn", "未检测到 OPENAI_API_KEY / ANTHROPIC_API_KEY", "设置后重启；或在 console → 设置 中添加供应商（存于库内）");
  }

  // ⑨ console 资源
  const consoleRes = resolveConsoleDir({ env: process.env });
  if (consoleRes.dir) {
    add("console", "ok", `${consoleRes.dir}（${consoleRes.source}）`);
  } else {
    add("console", "warn", "未找到 console 静态资源（API-only）", "安装 @vuagent/console（随 @vuagent/cli 依赖自动带上）；开发期 --console-dir apps/playground/dist");
  }

  // ⑩ MCP 配置（0.9.0 W1）：静态检查配置文件可解析（连接状态需运行时，见服务日志/API）
  try {
    const mcpConfigs = loadMcpConfigFile(paths.mcpConfigPath.path);
    if (mcpConfigs.length === 0) {
      add("mcp", "ok", "无 MCP 配置（mcp.json 不存在或为空——MCP 不启用）");
    } else {
      const enabled = mcpConfigs.filter((c) => c.enabled !== false);
      const disabled = mcpConfigs.length - enabled.length;
      add(
        "mcp",
        "ok",
        `mcp.json：${enabled.length} 个启用${disabled ? ` / ${disabled} 个禁用` : ""}（${enabled.map((c) => c.name).join(", ") || "-"}）；连接状态在服务运行时经日志查看`
      );
    }
  } catch (e) {
    add("mcp", "error", `mcp.json 解析失败：${e instanceof Error ? e.message : String(e)}`, "修复 JSON 语法或暂时移走该文件（服务会跳过 MCP 初始化）");
  }

  return checks;
}

/** 输出 + 退出码判定（json 模式下仍返回是否全绿供调用方定退出码） */
export function printDoctorReport(checks: DoctorCheck[], json: boolean): boolean {
  const hasError = checks.some((c) => c.status === "error");
  if (json) {
    console.log(JSON.stringify({ ok: !hasError, checks }, null, 2));
    return !hasError;
  }
  const icon = { ok: "✓", warn: "⚠", error: "✗" } as const;
  for (const c of checks) {
    console.log(`  ${icon[c.status]} ${c.check.padEnd(12)} ${c.detail}`);
    if (c.hint) console.log(`    ↳ ${c.hint}`);
  }
  console.log(hasError ? "\n✗ 存在 error 项" : "\n✓ 无 error 项（warn 为建议项）");
  return !hasError;
}
