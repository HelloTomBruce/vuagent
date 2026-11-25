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

/* ==========================================================================
   子进程环境净化（TASK-088）
   背景：bash 与服务同进程环境启动——模型 printenv 可直接读出
   OPENAI_API_KEY / VUAGENT_TOKEN 等密钥。safe 策略以白名单重建子进程环境，
   密钥类键名无论来源一律剥离（双保险）。
   ========================================================================== */

/** bash 子进程环境策略：safe（白名单，默认）/ strict（最小集）/ inherit（完整继承，现状口径） */
export type BashEnvPolicy = "safe" | "inherit" | "strict";

/**
 * safe 白名单：shell 可用的基础运行环境（PATH 找可执行、HOME 解 ~、
 * locale/时区/终端/临时目录/用户标识；Windows 补系统必需键）。
 * 刻意不含任何密钥类键名。
 */
const BASH_ENV_SAFE_KEYS = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER",
  "LOGNAME",
  "USERNAME",
  // 代理环境变量（审查 Optional 修复）：代理是基础设施而非密钥——
  // 缺失会导致受管代理环境下所有子进程网络命令（curl/git/npm）直连失败。
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // Windows 下子进程启动的系统必需键
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
]);

/** strict 最小集：仅进程定位与临时目录必需 */
const BASH_ENV_STRICT_KEYS = new Set(["PATH", "TMPDIR", "SYSTEMROOT"]);

/** 密钥类键名模式：无论策略如何一律剥离（对 inherit 不生效——那是显式 opting-in 的现状口径）。
 *  补齐 passphrase/pwd/auth 词根（审查 Nit 修复）；对 safe/strict 白名单制只是冗余防线。 */
const SECRET_ENV_KEY_RE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|PWD|CREDENTIAL|AUTH/i;

/**
 * 依据策略构建 bash 子进程环境（纯函数，可单测）。
 * - safe：白名单重建 + 密钥键名剥离；
 * - strict：最小集；
 * - inherit：完整继承 sourceEnv（部署方显式选择的行为，风险自担）。
 * 键名匹配大小写不敏感（Windows 环境键大小写不敏感；POSIX 常见键全大写，无损）。
 */
export function buildChildEnv(
  policy: BashEnvPolicy,
  sourceEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  if (policy === "inherit") {
    for (const [k, v] of Object.entries(sourceEnv)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const allow = policy === "strict" ? BASH_ENV_STRICT_KEYS : BASH_ENV_SAFE_KEYS;
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (v === undefined) continue;
    if (!allow.has(k.toUpperCase())) continue;
    if (SECRET_ENV_KEY_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** env 直读策略（兼容装配）：非法值 fail-closed 回落 safe */
function readEnvPolicyFromEnv(): BashEnvPolicy {
  const raw = (process.env.VUAGENT_BASH_ENV_POLICY || "").trim().toLowerCase();
  return raw === "inherit" || raw === "strict" ? raw : "safe";
}

export interface BashRunResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** 超时被杀时为 true，stdout/stderr 为已产生的部分输出 */
  timedOut?: boolean;
}

/**
 * 构造 bash_run 工具（TASK-088 工厂化）：环境策略由调用方解析——生产装配走
 * 配置中心 tools.bashEnvPolicy（env 锁定由 resolver 处理），运行中改档逐次生效；
 * 缺省回落 env 直读（VUAGENT_BASH_ENV_POLICY，非法值 safe）。
 */
export function createBashRunTool(
  resolveEnvPolicy: () => BashEnvPolicy | Promise<BashEnvPolicy> = readEnvPolicyFromEnv
): HarnessTool {
  return {
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
      "- 子进程环境变量默认净化（safe：仅保留 PATH/HOME 等基础白名单，密钥类变量一律剥离，printenv 读不到 API key）；可在「设置 → 工具」切 strict（最小集）或 inherit（完整继承服务进程环境，密钥可被读出，慎用）。",
    ].join("\n"),
    parameters: BashRunParamsSchema, // TASK-055：契约收口至 @vuagent/protocol
    riskLevel: "high",
    requiresApproval: true, // 核心 HITL 演示：触发人机审批拦截
    writesWorkspace: true, // 执行任意 Shell 命令具备写副作用（TASK-012：read-only 模式据此拦截）
    execute: async (ctx): Promise<BashRunResult> => {
      const cmd = String(ctx.args.command || "");
      const timeout = Number(ctx.args.timeoutMs) || 30_000;
      const envPolicy = await resolveEnvPolicy();

      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: ctx.workspace.rootPath,
          timeout,
          maxBuffer: EXEC_MAX_BUFFER,
          env: buildChildEnv(envPolicy),
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
}

/**
 * 兼容导出：env 直读装配（默认 safe 策略，VUAGENT_BASH_ENV_POLICY 可覆盖）。
 * server.ts 生产装配改用 createBashRunTool(configResolver 解析) 以获得运行中生效的
 * 配置中心口径。
 */
export const BashRunTool: HarnessTool = createBashRunTool();
