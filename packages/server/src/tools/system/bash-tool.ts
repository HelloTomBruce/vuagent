import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessTool } from "../../core/types.js";
import { BashRunParamsSchema } from "@vuagent/protocol";

const execAsync = promisify(exec);

/**
 * 输出截断阈值（字符数）：超出后保留末尾部分并标注被裁掉的长度。
 * 保留末尾是因为命令失败时的诊断信息（报错、堆栈）几乎总在输出的最后。
 */
export const BASH_OUTPUT_MAX_CHARS = 30_000;

/**
 * child_process.exec 的 maxBuffer：默认仅 1MB，超出会直接把进程杀掉
 * （报 "maxBuffer exceeded"）——那会让「截断」契约变成谎言。
 * 放宽到 10MB 收集完整输出，再由我们做截断，契约才成立。
 */
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

function truncateOutput(text: string): string {
  if (text.length <= BASH_OUTPUT_MAX_CHARS) return text;
  const dropped = text.length - BASH_OUTPUT_MAX_CHARS;
  return `[... 输出过长，已截断前 ${dropped} 字符，以下为末尾内容 ...]\n${text.slice(-BASH_OUTPUT_MAX_CHARS)}`;
}

export interface BashRunResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** 超时被杀时为 true，stdout/stderr 为已产生的部分输出 */
  timedOut?: boolean;
}

export const BashRunTool: HarnessTool = {
  name: "bash_run",
  description: [
    "在工作区根目录下通过系统默认 shell 执行命令（POSIX 为 /bin/sh -c；高风险动作，默认需人工审批）。",
    "执行契约：",
    "- 返回 { exitCode, stdout, stderr }。非零退出码【不】抛异常，照常返回三者，由你结合输出判断——grep 无匹配、条件检测等合法场景退出码也是非零。",
    "- stdout/stderr 各超过约 30000 字符时保留末尾并标注截断长度（失败诊断信息通常在末尾）；空输出不代表失败，以 exitCode 为准。",
    "- 每次调用都是全新 shell：cd、export、source、后台作业不会跨调用保留，需要时用 && 或 ; 串成一条命令。",
    "- && 链语义：任一环节失败（非零退出）后，后续命令不再执行，整体退出码为失败环节的退出码——把探测命令接进 && 链之前，先想清楚它失败会静默跳过后续动作。",
    "- 默认超时 30000ms（可用 timeoutMs 调整）；超时进程被杀死，返回 timedOut:true 与已产生的部分输出。有效超时另受执行器 60s 兜底上限约束。",
    "- 无法响应交互式输入：优先非交互式用法（-y/--yes、重定向、管道喂输入），交互式命令会挂起直至超时。",
    "- 命令在工作区根目录启动；读取/写入工作区外路径可能被沙箱策略拒绝。",
  ].join("\n"),
  parameters: BashRunParamsSchema, // TASK-055：契约收口至 @vuagent/protocol
  riskLevel: "high",
  requiresApproval: true, // 核心 HITL 演示：触发人机审批拦截
  writesWorkspace: true, // 执行任意 Shell 命令具备写副作用（TASK-012：read-only 模式据此拦截）
  execute: async (ctx): Promise<BashRunResult> => {
    const cmd = String(ctx.args.command || "");
    const timeout = Number(ctx.args.timeoutMs) || 30_000;

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: ctx.workspace.rootPath,
        timeout,
        maxBuffer: EXEC_MAX_BUFFER,
      });
      return {
        command: cmd,
        stdout: truncateOutput(stdout.trim()),
        stderr: truncateOutput(stderr.trim()),
        exitCode: 0,
      };
    } catch (err: unknown) {
      // exec 在非零退出/超时时 reject，err 上携带 code/stdout/stderr/killed/signal。
      // TASK-014：非零退出是命令的正常结果（契约见 description），结构化返回而非抛出——
      // 旧实现走通用异常通道，stdout 丢失，模型只能看到 "Command failed"。
      const e = err as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
        message?: string;
      };
      const timedOut = e.killed === true && e.signal === "SIGTERM";
      const exitCode =
        typeof e.code === "number" ? e.code : timedOut ? -1 : 1;
      return {
        command: cmd,
        stdout: truncateOutput(String(e.stdout ?? "").trim()),
        stderr: truncateOutput(String(e.stderr ?? e.message ?? "").trim()),
        exitCode,
        ...(timedOut ? { timedOut: true } : {}),
      };
    }
  },
};
