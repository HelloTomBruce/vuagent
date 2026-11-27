/**
 * 评审 R4 回归：node:sqlite 不可用时，doctor 必须**给出可执行指引**而不是崩掉。
 * 早期实现顶层静态 import node:sqlite —— 在 Node < 22.13 上模块加载期就
 * ERR_UNKNOWN_BUILTIN_MODULE，连 `vuagent --help` 都跑不起来，用户看不到升级提示。
 * 现在 db.ts 延迟加载；本测试把 loadSqlite 替换成抛错，断言 doctor 输出 error + hint。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/db.js")>();
  return {
    ...actual,
    loadSqlite: async () => {
      throw new actual.SqliteUnavailableError(
        "当前 Node v0.0.0 不提供可用的 node:sqlite。请升级到 Node ≥ 22.13",
      );
    },
  };
});

const { runDoctor } = await import("../src/commands/doctor.js");
const { resolveDataPaths } = await import("@vuagent/server");

describe("doctor · node:sqlite 不可用（R4）", () => {
  it("把不可用变成 error 项 + 可执行 hint，而不是抛异常", async () => {
    const paths = resolveDataPaths({ dataDir: "/tmp/vuagent-doctor-no-sqlite", env: {} });
    const checks = await runDoctor(paths, {});
    const entry = checks.find((c) => c.check === "node:sqlite");
    expect(entry?.status).toBe("error");
    expect(entry?.detail).toMatch(/node:sqlite/);
    expect(entry?.hint).toMatch(/22\.13/);
    // 其余检查仍尽量产出（不因一个依赖缺失整份体检失败）
    expect(checks.length).toBeGreaterThan(3);
  });
});
