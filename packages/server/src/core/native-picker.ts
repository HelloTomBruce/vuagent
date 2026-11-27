/**
 * 操作系统原生文件夹选择器（工作区创建用）。
 *
 * 背景：浏览器无法把目录的**绝对路径**交给服务端（File System Access API 只给
 * handle，不给路径），所以「点按钮选文件夹」必须由**运行服务的那台机器**弹原生框
 * ——这正是本地优先工具的常规做法。
 *
 * 0.7.1 及更早的实现把所有非零退出都当失败：用户点「取消」时 osascript 以
 * `用户已取消。 (-128)` 退出 → 接口回 500 → 前端降级成「手动输入路径」——
 * 用户看到的现象就是「点新建工作区，却让我手打路径」。本模块把三态区分开：
 * 选中 / 取消 / 不可用（带可执行提示），且用 execFile 传参避免 shell 引号问题。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 原生框最长等待：用户可能长时间不理会对话框，不能让它永久占住请求 */
export const PICKER_TIMEOUT_MS = 10 * 60_000;

export type PickerOutcome =
  | { status: "picked"; path: string }
  | { status: "cancelled" }
  | { status: "unavailable"; reason: string; hint?: string };

export interface PickerCommand {
  cmd: string;
  args: string[];
  /** 给日志与错误提示用的人类可读名 */
  label: string;
}

/** 各平台的原生选择器命令（null = 该平台不支持） */
export function pickerCommand(platform: NodeJS.Platform = process.platform): PickerCommand | null {
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "请选择一个本地项目文件夹作为工作区")'],
      label: "macOS 原生文件夹选择框",
    };
  }
  if (platform === "win32") {
    return {
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.windows.forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }",
      ],
      label: "Windows 文件夹浏览框",
    };
  }
  return {
    cmd: "zenity",
    args: ["--file-selection", "--directory", "--title=请选择一个本地项目文件夹作为工作区"],
    label: "zenity 文件夹选择框",
  };
}

/** 成功分支：stdout 为路径；空输出即用户取消（Windows/部分 zenity 行为） */
export function classifyStdout(stdout: string): PickerOutcome {
  const picked = stdout.trim();
  if (!picked) return { status: "cancelled" };
  return { status: "picked", path: picked };
}

/**
 * 失败分支：区分「用户取消」与「真的不可用」。
 * - macOS：osascript 取消时退出码 1，stderr 含 `-128` / `用户已取消` / `User canceled`；
 * - Linux：zenity 取消退出码 1（stderr 为空）；
 * - ENOENT：命令根本不存在（zenity 未安装）。
 */
export function classifyFailure(
  platform: NodeJS.Platform,
  info: { code?: number | string; stderr?: string; message?: string; killed?: boolean; signal?: string; },
): PickerOutcome {
  const stderr = `${info.stderr ?? ""}\n${info.message ?? ""}`;
  const cancelled =
    /-128\b/.test(stderr) || /用户已取消/.test(stderr) || /user cancel(?:l)?ed/i.test(stderr);
  if (cancelled) return { status: "cancelled" };

  // zenity 取消的另一形态：退出码 1 且没有任何输出（它取消时不打印）
  if (platform === "linux" && info.code === 1 && !(info.stderr ?? "").trim()) {
    return { status: "cancelled" };
  }

  const missingCmd =
    info.code === "ENOENT" || /ENOENT|not found|不是内部或外部命令|command not found/i.test(stderr);
  if (missingCmd) {
    const cmd = pickerCommand(platform)?.cmd ?? "选择器";
    const hint =
      platform === "linux"
        ? "缺少 zenity：Debian/Ubuntu 执行 `sudo apt install zenity`，Fedora 执行 `sudo dnf install zenity`。装好后重试，或直接手动输入绝对路径。"
        : platform === "darwin"
          ? "确认服务是从有图形界面的终端启动的（SSH / 无窗口环境无法弹框）；也可手动输入绝对路径。"
          : "确认服务在交互式桌面会话中运行；也可手动输入绝对路径。";
    return { status: "unavailable", reason: `找不到 ${cmd}`, hint };
  }

  // execFile 超时的真实形态：killed=true + signal 被置位，stderr 为空，message 只有
  // "Command failed: …"（不含 timed out 字样）——所以必须按信号判定，否则用户看到的
  // "原因"是一整行 osascript 命令（评审 O1）。
  const timedOut =
    info.killed === true || Boolean(info.signal) || /timed? ?out|ETIMEDOUT/i.test(stderr);
  if (timedOut) {
    return {
      status: "unavailable",
      reason: "选择框等待超时（10 分钟未选择）",
      hint: "重新点击「新建工作区」重试，或直接手动输入绝对路径。",
    };
  }

  const firstLine = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/TISFileInterrogator|Keyboard Layouts|^20\d\d-/.test(l))
    .pop();
  return {
    status: "unavailable",
    reason: firstLine ? firstLine.slice(0, 200) : "系统文件夹选择器调用失败",
    hint: "可重试；持续失败时请手动输入绝对路径。",
  };
}

/** 注入式执行器（测试用） */
export type PickerRunner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: PickerRunner = async (cmd, args) => {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: PICKER_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: false,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/** 弹出原生框并归类结果（不抛错：失败以 outcome 表达，接口据此给 200/409/503） */
export async function pickNativeDirectory(options?: {
  platform?: NodeJS.Platform;
  run?: PickerRunner;
}): Promise<PickerOutcome> {
  const platform = options?.platform ?? process.platform;
  const command = pickerCommand(platform);
  if (!command) {
    return { status: "unavailable", reason: `平台 ${platform} 不支持原生选择框` };
  }
  const run = options?.run ?? defaultRunner;
  try {
    const { stdout } = await run(command.cmd, command.args);
    return classifyStdout(stdout);
  } catch (err) {
    const e = err as { code?: number | string; stderr?: string; message?: string; killed?: boolean; signal?: string };
    return classifyFailure(platform, e);
  }
}
