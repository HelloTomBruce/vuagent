import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

const execAsync = promisify(exec);

export const BashRunTool: HarnessTool = {
  name: "bash_run",
  description: "在工作区根目录下执行指定的 Shell 终端命令（高风险动作，默认需人工审批）",
  parameters: Type.Object({
    command: Type.String({ description: "要执行的 Shell 命令" }),
    timeoutMs: Type.Optional(Type.Number({ description: "执行超时毫秒数，默认 30000" })),
  }),
  riskLevel: "high",
  requiresApproval: true, // 核心 HITL 演示：触发人机审批拦截
  execute: async (ctx) => {
    const cmd = String(ctx.args.command || "");
    const timeout = Number(ctx.args.timeoutMs) || 30_000;

    const { stdout, stderr } = await execAsync(cmd, {
      cwd: ctx.workspace.rootPath,
      timeout,
    });

    return {
      command: cmd,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  },
};
