import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceEntity } from "../storage/interfaces.js";
import {
  PERMISSION_MODE_DESCRIPTIONS,
  type EffectivePermissionMode,
} from "./permissions.js";

/**
 * 系统提示词构建（TASK-014）
 *
 * 对标业界主流 Harness 的三层机制（Codex CLI / Claude Code 公开 prompt 结构）：
 * ① 运行时环境披露 —— 平台、OS、shell、cwd、git、当前日期显式注入，平台不靠模型猜；
 * ② 沙箱/审批模式声明 —— 生效权限模式每轮声明（与 permissions.ts 的仲裁逻辑同源）；
 * ③ 操作纪律 —— 失败重试上限、不虚构执行结果、非交互式优先、先搜再读再改。
 * 工具执行契约（退出码/截断/超时语义）按「写进 schema 而非正文」原则，
 * 落在各工具的 description 中（见 tools/system/bash-tool.ts），此处不重复。
 */

/** 运行时环境信息（可注入替身以便测试） */
export interface RuntimeEnvInfo {
  platform: string;
  osRelease: string;
  arch: string;
  shell: string;
  nodeVersion: string;
  homeDir: string;
  timezone: string;
  now: Date;
  isGitRepo: boolean;
}

/** 采集真实运行时环境（turn 构建期调用一次；isGitRepo 探测 .git 存在性） */
export function collectRuntimeEnv(rootPath: string): RuntimeEnvInfo {
  return {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    shell: process.env.SHELL || "(unknown)",
    nodeVersion: process.version,
    homeDir: os.homedir(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "(unknown)",
    now: new Date(),
    isGitRepo: fs.existsSync(path.join(rootPath, ".git")),
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/** 格式化为本地时间：2026-11-18 11:56:42 (Asia/Shanghai, UTC+8) */
function formatLocalTime(now: Date, timezone: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offset = `UTC${sign}${abs / 60}`;
  return `${date} ${time} (${timezone}, ${offset})`;
}

/** 运行环境披露块（对标 Codex ## Environment / Claude Code <env>） */
export function buildEnvironmentBlock(
  workspace: WorkspaceEntity,
  env: RuntimeEnvInfo
): string {
  const platformLabel = PLATFORM_LABELS[env.platform] || env.platform;
  return [
    "## 运行环境（Runtime Environment）",
    "以下环境信息为运行时实测注入，以此为准——不要凭训练印象假设平台、路径或日期：",
    `- 平台: ${env.platform} (${platformLabel} ${env.osRelease})`,
    `- 架构: ${env.arch}`,
    `- Shell: ${env.shell}（bash_run 工具经 /bin/sh -c 执行）`,
    `- Node.js: ${env.nodeVersion}`,
    `- HOME: ${env.homeDir}`,
    `- 工作区: ${workspace.name}（路径: ${workspace.rootPath}）`,
    `- 工作区是 Git 仓库: ${env.isGitRepo ? "是" : "否"}`,
    `- 当前时间: ${formatLocalTime(env.now, env.timezone)}`,
  ].join("\n");
}

const WORKSPACE_PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "read-only": "read-only —— 工作区级硬闸门：任何模式（含 auto）下写工作区工具都会被拦截",
  "read-write": "read-write —— 允许读写，写操作是否需审批由生效模式决定",
  danger: "danger —— 完全访问，无工作区级限制",
};

/** 权限与审批模式声明块 */
export function buildPermissionBlock(
  workspace: WorkspaceEntity,
  effectiveMode: EffectivePermissionMode
): string {
  return [
    "## 权限与审批模式",
    `- 本轮生效模式: ${PERMISSION_MODE_DESCRIPTIONS[effectiveMode]}`,
    `- 工作区权限: ${WORKSPACE_PERMISSION_DESCRIPTIONS[workspace.permission] ?? workspace.permission}`,
    "权限模式可能逐轮变化，以本轮声明为准；被拦截或被驳回的工具调用不要换汤不换药地重试同一动作。",
  ].join("\n");
}

/** 操作纪律块（对标 Codex 失败重试纪律 / Claude Code 行为规范） */
export function buildDisciplineBlock(): string {
  return [
    "## 操作纪律",
    "1. 同一命令或操作连续失败 2~3 次后停止重试：总结已尝试的方案与失败现象，向用户说明并请示下一步，不要盲目换参数硬试。",
    "2. 绝不谎称执行过命令，绝不虚构命令输出、文件内容或测试结果；没跑过就说没跑过。",
    "3. 优先使用非交互式命令（加 -y/--yes、用管道或重定向喂输入）；本环境无法响应交互式提示，交互命令会挂起直到超时。",
    "4. 改动前先了解现状：先搜索定位，再读取相关文件，再执行验证，最后才修改；修改已有文件前必须先读过它。",
    "5. 工具结果只信实际返回：bash_run 的非零退出码不代表工具故障（grep 无匹配也会返回 1），结合 stdout/stderr 判断；空输出不等于失败。",
  ].join("\n");
}

/**
 * 提示词组装配置（TASK-027，来自配置中心 prompt 命名空间）。
 * 缺省与历史硬编码行为严格等价（两块开、无全局自定义指令）。
 */
export interface PromptAssemblyConfig {
  /**
   * 全局自定义指令：纯文本追加到系统提示末尾（所有内置块之后）。
   * 安全边界：只能追加，不能覆盖/删除内置的身份、安全与工具契约块；
   * 该文本会进入每轮模型上下文，属于 prompt 注入面——配置它的用户即
   * 本机唯一操作者（威胁模型见 security.ts），不引入新的信任边界。
   */
  customInstructions?: string;
  /** 环境块开关（默认 true） */
  includeEnvironmentBlock?: boolean;
  /** 权限声明块开关（默认 true） */
  includePermissionBlock?: boolean;
  /**
   * 显式终态协议开关（execution.finishTaskMode=enforced 时为 true）：
   * 向模型声明「完成必须调用 finish_task 且通过交付断言」的契约块。
   * 与工具可见性同源（agent-loop 同一配置推导），提示词声明与引擎裁决不漂移。
   */
  finishTaskEnforced?: boolean;
}

export interface BuildSystemPromptOptions {
  workspace: WorkspaceEntity;
  /** 生效权限模式（由 permissions.ts resolveEffectivePermissionMode 解析，与仲裁同源） */
  effectiveMode: EffectivePermissionMode;
  /** 会话级附加上下文（session.systemContext） */
  sessionSystemContext?: string;
  /** 可注入的环境信息替身；缺省按工作区实时采集 */
  env?: RuntimeEnvInfo;
  /** 提示词组装配置（TASK-027）；缺省 = 两块开 + 无全局自定义指令 */
  promptConfig?: PromptAssemblyConfig;
}

/** 组装完整系统提示词：身份 + 环境披露 + 权限声明 + 操作纪律 + 工作区/会话/全局自定义指令 */
export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const includeEnv = opts.promptConfig?.includeEnvironmentBlock ?? true;
  const includePermission = opts.promptConfig?.includePermissionBlock ?? true;

  const parts: string[] = [
    "你是一个基于标准 Harness 运行的高级智能体助手，在工作区沙箱内协助用户完成工程任务。",
  ];
  // 环境采集有文件系统探测（.git），块关闭时跳过
  if (includeEnv) {
    const env = opts.env ?? collectRuntimeEnv(opts.workspace.rootPath);
    parts.push(buildEnvironmentBlock(opts.workspace, env));
  }
  if (includePermission) {
    parts.push(buildPermissionBlock(opts.workspace, opts.effectiveMode));
  }
  parts.push(buildDisciplineBlock());

  // 显式终态协议块（finishTaskMode=enforced）：与引擎侧交付断言同源声明
  if (opts.promptConfig?.finishTaskEnforced) {
    parts.push(
      [
        "## 任务完成协议",
        "完成任务时必须调用 finish_task 工具宣告：summary 概括做了什么与结果，deliverables 列出交付物。",
        "只有在本轮已产出实质性内容（面向用户的正文回复或工具产物）后才可宣告完成；",
        "若交付断言未通过，你会收到结构化驳回说明——继续完成任务并产出实质内容后再次宣告。",
      ].join("\n")
    );
  }

  // 工作区级与会话级自定义指令置后（用户显式配置优先级最高）
  if (opts.workspace.systemInstruction?.trim()) {
    parts.push(`## 工作区自定义指令\n${opts.workspace.systemInstruction.trim()}`);
  }
  if (opts.sessionSystemContext?.trim()) {
    parts.push(`## 会话上下文\n${opts.sessionSystemContext.trim()}`);
  }

  // 全局自定义指令（TASK-027）：固定追加在所有内置块之后——只能追加，
  // 不能覆盖/删除内置安全与契约块（注入面见 PromptAssemblyConfig 注释）
  const custom = opts.promptConfig?.customInstructions?.trim();
  if (custom) {
    parts.push(`## 用户自定义指令\n${custom}`);
  }

  return parts.join("\n\n");
}
