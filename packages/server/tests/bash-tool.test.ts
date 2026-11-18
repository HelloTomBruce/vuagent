import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BashRunTool, BASH_OUTPUT_MAX_CHARS, type BashRunResult } from "../src/tools/system/bash-tool.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import type { ToolExecutionContext } from "../src/core/types.js";
import type { WorkspaceEntity } from "../src/storage/interfaces.js";

/**
 * TASK-014 bash_run 工具执行契约回归（契约写进 schema，实现与契约一致）：
 * - 非零退出码不抛异常，结构化返回 { exitCode, stdout, stderr }
 * - 输出超阈值保留末尾并标注截断
 * - 空输出不代表失败
 * - && 链中任一环节失败后后续静默跳过（语义文档化）
 * - 超时杀进程并标记 timedOut，保留部分输出
 * - 每次调用都是全新 shell（cwd 固定为工作区根目录）
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeCtx(args: Record<string, unknown>): Promise<{ ctx: ToolExecutionContext; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vuagent-bash-"));
  tmpDirs.push(dir);
  const workspace: WorkspaceEntity = {
    id: "ws-bash",
    name: "Bash Workspace",
    rootPath: dir,
    permission: "read-write",
    createdAt: 0,
    updatedAt: 0,
  };
  return {
    dir,
    ctx: {
      toolCallId: "call-test",
      args,
      workspace,
      actionHub: new ActionHub(),
      abortSignal: new AbortController().signal,
    },
  };
}

async function runBash(command: string, timeoutMs?: number): Promise<BashRunResult> {
  const { ctx } = await makeCtx(timeoutMs === undefined ? { command } : { command, timeoutMs });
  return (await BashRunTool.execute(ctx)) as BashRunResult;
}

describe("bash_run 执行契约", () => {
  it("成功命令：exitCode 0 且 stdout 正确", async () => {
    const res = await runBash("echo hello-vuagent");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("hello-vuagent");
    expect(res.stderr).toBe("");
    expect(res.timedOut).toBeUndefined();
  });

  it("非零退出码不抛异常：exitCode/stdout/stderr 三者完整保留", async () => {
    // 旧实现走异常通道 stdout 丢失；契约要求照常返回三者由模型判断
    const res = await runBash("echo probe-out; echo probe-err >&2; exit 3");
    expect(res.exitCode).toBe(3);
    expect(res.stdout).toBe("probe-out");
    expect(res.stderr).toBe("probe-err");
  });

  it("&& 链语义：前置探测失败后后续命令静默跳过", async () => {
    // 这正是任务背景里的类型三失败场景：探测命令接进 && 链，
    // 失败时后续动作不执行、退出码为失败环节的退出码——契约已文档化
    const res = await runBash("false && echo never-printed");
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toBe("");
  });

  it("空输出不代表失败：true 命令 exitCode 0 且输出为空", async () => {
    const res = await runBash("true");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });

  it("超长输出保留末尾并标注截断长度", async () => {
    const total = BASH_OUTPUT_MAX_CHARS + 20_000;
    const res = await runBash(`node -e "process.stdout.write('x'.repeat(${total}))"`);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("已截断前 20000 字符");
    // 截断后长度 = 标记行 + 末尾 BASH_OUTPUT_MAX_CHARS 字符
    expect(res.stdout.length).toBeLessThanOrEqual(BASH_OUTPUT_MAX_CHARS + 100);
    expect(res.stdout.endsWith("x".repeat(100))).toBe(true);
  });

  it("超时杀进程：timedOut=true 且保留部分输出", async () => {
    const res = await runBash("echo before-sleep; sleep 30", 300);
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).toBe("before-sleep");
  }, 10_000);

  it("每次调用都是全新 shell：cd 不跨调用保留，cwd 固定为工作区根目录", async () => {
    const { ctx, dir } = await makeCtx({ command: "pwd -P" });
    const first = (await BashRunTool.execute(ctx)) as BashRunResult;
    const realDir = await fs.realpath(dir);
    expect(first.stdout).toBe(realDir);

    // 同一会话内第二次调用：上一次 cd 不影响本次 cwd
    const second = (await BashRunTool.execute({
      ...ctx,
      args: { command: "cd / && pwd -P" },
    })) as BashRunResult;
    expect(second.stdout).toBe("/");

    const third = (await BashRunTool.execute(ctx)) as BashRunResult;
    expect(third.stdout).toBe(realDir);
  });

  it("经 ToolRegistry 执行：非零退出仍是 isError=false 的正常结果", async () => {
    const { ctx } = await makeCtx({ command: "echo o; exit 2" });
    const registry = new ToolRegistry();
    registry.register(BashRunTool);
    const res = await registry.execute("bash_run", { ...ctx, args: { command: "echo o; exit 2" } });
    expect(res.isError).toBe(false);
    const result = res.result as BashRunResult;
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("o");
  });

  it("工具描述包含执行契约关键条款（schema 层文档化）", () => {
    const desc = BashRunTool.description;
    expect(desc).toContain("非零退出码");
    expect(desc).toContain("30000");
    expect(desc).toContain("空输出不代表失败");
    expect(desc).toContain("全新 shell");
    expect(desc).toContain("&& 链语义");
    expect(desc).toContain("timedOut");
    expect(desc).toContain("交互式");
  });
});
