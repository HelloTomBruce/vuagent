import type { HarnessStreamEvent } from "./types.js";
import type { TurnEntity, WorkspaceEntity } from "../storage/interfaces.js";

export interface SandboxDemoContext {
  workspace: WorkspaceEntity;
  sessionId: string;
  prompt: string;
  modelProfileName: string;
  modelProfileProvider: string;
  messageId: string;
  turnId: string;
  startAt: number;
}

/**
 * 无 API Key 时的沙箱演示分支（TASK-005 从 agent-loop 核心剥离）
 * 以固定脚本演示 plan/diff/terminal 卡片与流式节奏，引导用户配置真实模型。
 * 保持 agent-loop 的 ReAct 主流程纯净：演示内容只存在于本模块。
 */
export async function *runSandboxDemoTurn(
  ctx: SandboxDemoContext,
  appendTurn: (turn: TurnEntity) => Promise<void>
): AsyncGenerator<HarnessStreamEvent> {
  const { workspace, prompt, messageId, turnId, startAt } = ctx;

  const thoughtText = `收到任务:「${prompt}」\n工作区: ${workspace.name} (${workspace.rootPath})\n当前选中的模型是 ${ctx.modelProfileName} (${ctx.modelProfileProvider})，未检测到 API Key，启动沙箱交互引擎与计划编排...`;
  yield {
    type: "thought_delta",
    messageId,
    delta: thoughtText,
  };

  const planData = {
    title: "任务执行计划",
    steps: [
      { id: "step-1", title: "解析任务目标与工作区架构", status: "done" as const, duration: 320 },
      { id: "step-2", title: "提取重构模块并生成代码变更", status: "done" as const, duration: 580 },
      { id: "step-3", title: "运行沙箱自动化测试套件", status: "done" as const, duration: 420 },
      { id: "step-4", title: "生成状态检查点与审查报告", status: "done" as const, duration: 150 },
    ],
  };

  // 实时同步任务执行计划到输入框上方的 VaAgentPlan
  yield {
    type: "ui_agent_plan",
    title: planData.title,
    steps: [
      { id: "step-1", title: "解析任务目标与工作区架构", status: "running", startedAt: Date.now() },
      { id: "step-2", title: "提取重构模块并生成代码变更", status: "pending" },
      { id: "step-3", title: "运行沙箱自动化测试套件", status: "pending" },
      { id: "step-4", title: "生成状态检查点与审查报告", status: "pending" },
    ],
  };

  yield {
    type: "text_delta",
    messageId,
    delta: `已接收任务指令：**${prompt}**\n\nAgent 已在工作区 \`${workspace.name}\` 建立沙箱并开始规划。\n\n`,
  };

  // 步骤 1 完成，步骤 2 进行中
  yield {
    type: "ui_agent_plan",
    title: "任务执行计划",
    steps: [
      { id: "step-1", title: "解析任务目标与工作区架构", status: "done", duration: 320 },
      { id: "step-2", title: "提取重构模块并生成代码变更", status: "running", startedAt: Date.now() },
      { id: "step-3", title: "运行沙箱自动化测试套件", status: "pending" },
      { id: "step-4", title: "生成状态检查点与审查报告", status: "pending" },
    ],
  };

  // 产出 Code Diff 卡片
  const diffCard = {
    id: `diff-${Date.now()}`,
    type: "diff",
    data: {
      file: "src/auth/jwt-service.ts",
      additions: 18,
      deletions: 4,
      oldCode: `// 旧版内联验证\nfunction verify(token: string) {\n  return token.startsWith("bearer_");\n}`,
      newCode: `import { SignJWT, jwtVerify } from "jose";\n\nexport async function verifyJwt(token: string, secret: Uint8Array) {\n  const { payload } = await jwtVerify(token, secret, {\n    algorithms: ["HS256"],\n  });\n  return payload;\n}`,
    },
  };

  yield {
    type: "ui_code_diff",
    ...diffCard.data,
  };

  // 步骤 2 完成，步骤 3 进行中
  yield {
    type: "ui_agent_plan",
    title: "任务执行计划",
    steps: [
      { id: "step-1", title: "解析任务目标与工作区架构", status: "done", duration: 320 },
      { id: "step-2", title: "提取重构模块并生成代码变更", status: "done", duration: 580 },
      { id: "step-3", title: "运行沙箱自动化测试套件", status: "running", startedAt: Date.now() },
      { id: "step-4", title: "生成状态检查点与审查报告", status: "pending" },
    ],
  };

  // 产出终端执行日志
  const termCard = {
    id: `term-${Date.now()}`,
    type: "terminal",
    data: {
      title: "pnpm test:auth",
      lines: [
        { text: "$ pnpm vitest run tests/auth.test.ts", kind: "cmd" as const },
        { text: "✓ tests/auth.test.ts > verifyJwt validates token correctly (4ms)", kind: "ok" as const },
        { text: "Test Files  1 passed (1)", kind: "ok" as const },
        { text: "Tests       3 passed (3)", kind: "ok" as const },
      ],
    },
  };

  yield {
    type: "ui_terminal_log",
    title: termCard.data.title,
    lines: termCard.data.lines,
  };

  // 步骤全部完成
  yield {
    type: "ui_agent_plan",
    title: planData.title,
    steps: planData.steps,
  };

  const tipText = `\n\n---\n> 💡 **提示**：当前尚未配置 **${ctx.modelProfileName}** 的 API Key。请在左下角 **「⚙️ 模型与 API 配置」** 填入您的 API Key（或选择本地 Ollama），保存后即可直接接入真实大模型实时推理！`;
  yield {
    type: "text_delta",
    messageId,
    delta: tipText,
  };

  const totalDuration = Date.now() - startAt;
  yield {
    type: "turn_end",
    stepCount: 1,
    durationMs: totalDuration,
  };

  const fullContent = `已接收任务指令：**${prompt}**\n\nAgent 已在工作区 \`${workspace.name}\` 建立沙箱并开始规划。\n\n${tipText}`;

  const turnEntity: TurnEntity = {
    id: turnId,
    sessionId: ctx.sessionId,
    prompt,
    content: fullContent,
    thought: thoughtText,
    cards: [diffCard, termCard],
    plan: planData,
    status: "done",
    stepCount: 1,
    checkpoints: [],
    telemetry: {
      durationMs: totalDuration,
      ttftMs: 50,
      totalTokens: 256,
      promptTokens: 120,
      completionTokens: 136,
      laneEventsCount: 4,
    },
    createdAt: startAt,
    completedAt: Date.now(),
  };
  await appendTurn(turnEntity);
}
