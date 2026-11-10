<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  VaAgentInbox,
  VaAgentPlan,
  VaApprovalCard,
  VaButton,
  VaContextWindow,
  VaDecisionInbox,
  VaInlineDiff,
  VaMemoryPanel,
  VaToolCallCard,
} from "@vuagent/ui";
import type { AgentTask, ContextPart, MemoryItem, PlanStep } from "@vuagent/ui";

/* ---------- 计划 ---------- */
const planSteps = ref<PlanStep[]>([
  { id: "s1", title: "读取路由与主题配置", detail: "src/router.ts · tokens.css" },
  { id: "s2", title: "修改 Hero 组件文案与结构", detail: "2 个文件" },
  { id: "s3", title: "安装测试依赖", detail: "pnpm add -D vitest（需要审批）" },
  { id: "s4", title: "运行构建验证", detail: "pnpm build" },
  { id: "s5", title: "生成变更摘要并提交", detail: "git commit" },
]);

/* ---------- 工具调用 ---------- */
type ToolRunStatus = "running" | "success" | "error";
type ToolState = {
  name: string;
  summary: string;
  status: "idle" | ToolRunStatus;
  args: unknown;
  result?: unknown;
  error?: string;
  startedAt?: number;
  duration?: number;
};
const tools = ref<ToolState[]>([
  { name: "fs.read", summary: "读取 router.ts 与 tokens.css", status: "idle", args: { files: ["src/router.ts", "tokens.css"] } },
  { name: "fs.edit", summary: "修改 Hero 组件（2 处）", status: "idle", args: { file: "src/components/Hero.vue", changes: 2 } },
  { name: "pm.install", summary: "安装 vitest", status: "idle", args: { packages: ["vitest"], dev: true } },
]);
const startedTools = computed(() =>
  tools.value.filter((t): t is ToolState & { status: ToolRunStatus } => t.status !== "idle"),
);

/* ---------- 审批 ---------- */
const approvalVisible = ref(false);

/* ---------- 任务收件箱 ---------- */
const tasks = ref<AgentTask[]>([
  { id: "t1", title: "整理 README 的组件导航", agent: "docs-agent", status: "queued", steps: ["已扫描 14 个组件目录"] },
  { id: "t2", title: "为新组件补齐 Props 文档", agent: "docs-agent", status: "queued" },
  { id: "t3", title: "修复暗色模式下的对比度问题", agent: "ui-agent", status: "queued" },
]);

/* ---------- 上下文 ---------- */
const compacting = ref(false);
const contextParts = ref<ContextPart[]>([
  { id: "c1", label: "system.md", tokens: 1_800, kind: "system" },
  { id: "c2", label: "Hero.vue", tokens: 2_400, kind: "file" },
  { id: "c3", label: "tokens.css", tokens: 900, kind: "file" },
  { id: "c4", label: "对话历史", tokens: 6_200, kind: "history" },
  { id: "c5", label: "工具结果", tokens: 2_100, kind: "tools" },
]);
function compact() {
  compacting.value = true;
  schedule(() => {
    contextParts.value = contextParts.value.map((p) =>
      p.kind === "history" ? { id: p.id, label: "压缩后的摘要", tokens: 1_600, kind: "history" as const } : p,
    );
    compacting.value = false;
  }, 900);
}

/* ---------- 记忆 ---------- */
const memEnabled = ref(true);
const memories = ref<MemoryItem[]>([
  { id: "m1", category: "偏好", text: "组件注释用中文，变量名用英文" },
  { id: "m2", category: "偏好", text: "提交信息遵循 Conventional Commits" },
  { id: "m3", category: "项目", text: "vuagent 使用 pnpm workspaces 管理" },
  { id: "m4", category: "团队", text: "发布前必须过 typecheck 与测试" },
]);

/* ---------- Inline Diff ---------- */
const diffOriginal = "点击按钮后，界面会立刻刷新并显示加载动画。";
const diffRevised = "点击按钮后，界面会立即刷新，并显示微光加载动画。";
const diffApplied = ref("");

/* ---------- 决策收件箱 ---------- */
const decisions = ref([
  {
    id: "d1",
    title: "定价页新版本发布到生产环境",
    detail: "A/B 转化 +8.2%，已通过评审",
    primary: "立即发布",
    secondary: "再等一天",
    collapsed: true,
  },
]);

/* ---------- 模拟编排 ---------- */
const phase = ref<"idle" | "running" | "waiting-approval" | "error" | "done">("idle");
const timers = ref<number[]>([]);
function schedule(fn: () => void, ms: number) {
  timers.value.push(window.setTimeout(fn, ms));
}
function clearTimers() {
  for (const t of timers.value) window.clearTimeout(t);
  timers.value = [];
}
onBeforeUnmount(clearTimers);

function setStep(id: string, patch: Partial<PlanStep>) {
  planSteps.value = planSteps.value.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
function setTool(name: string, patch: Partial<ToolState>) {
  tools.value = tools.value.map((t) => (t.name === name ? { ...t, ...patch } : t));
}
function setTask(id: string, patch: Partial<AgentTask>) {
  tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

function reset() {
  clearTimers();
  phase.value = "idle";
  approvalVisible.value = false;
  planSteps.value = planSteps.value.map((s) => ({ ...s, status: undefined, startedAt: undefined, duration: undefined }));
  tools.value = tools.value.map((t) => ({ ...t, status: "idle", startedAt: undefined, duration: undefined, error: undefined }));
  tasks.value = tasks.value.map((t) => ({ ...t, status: "queued", duration: undefined, startedAt: undefined }));
}

function start() {
  reset();
  phase.value = "running";
  const t0 = Date.now();

  // 步骤 1 + 工具 1
  setStep("s1", { status: "running", startedAt: t0 });
  setTool("fs.read", { status: "running", startedAt: t0 });
  setTask("t1", { status: "running", startedAt: t0 });

  schedule(() => {
    setTool("fs.read", { status: "success", duration: 1300 });
    setStep("s1", { status: "done", duration: 1300 });

    // 步骤 2 + 工具 2
    const t1 = Date.now();
    setStep("s2", { status: "running", startedAt: t1 });
    setTool("fs.edit", { status: "running", startedAt: t1 });
    schedule(() => {
      setTool("fs.edit", { status: "success", duration: 1500 });
      setStep("s2", { status: "done", duration: 1500 });

      // 步骤 3：需要审批
      setStep("s3", { status: "running", startedAt: Date.now() });
      approvalVisible.value = true;
      phase.value = "waiting-approval";
      setTask("t2", { status: "waiting", startedAt: Date.now() });
    }, 1500);
  }, 1300);
}

function onApprove() {
  const startedAt = planSteps.value.find((s) => s.id === "s3")?.startedAt ?? Date.now();
  setStep("s3", { status: "done", duration: Date.now() - startedAt });
  const t = Date.now();
  setTool("pm.install", { status: "running", startedAt: t, summary: "安装 vitest（已批准）" });
  setTask("t2", { status: "running" });

  schedule(() => {
    setTool("pm.install", { status: "success", duration: Date.now() - t });

    // 步骤 4：构建（演示一次失败 → 重试恢复）
    const t2 = Date.now();
    setStep("s4", { status: "running", startedAt: t2 });
    schedule(() => {
      setStep("s4", { status: "error" });
      phase.value = "error";
    }, 1400);
  }, 1400);
}

function onDeny(_reason?: "manual" | "timeout") {
  setStep("s3", { status: "error" });
  phase.value = "error";
  setTask("t2", { status: "queued" });
}

// 工具卡 / 计划的"重试"：构建失败后点击 → 重跑 → 成功 → 收尾
function onToolRetry() {
  if (phase.value !== "error") return;
  const t = Date.now();
  setStep("s4", { status: "running", startedAt: t });
  phase.value = "running";
  schedule(() => {
    setStep("s4", { status: "done", duration: Date.now() - t });

    // 步骤 5 收尾
    const t2 = Date.now();
    setStep("s5", { status: "running", startedAt: t2 });
    setTask("t1", { status: "done", duration: 6200 });
    setTask("t2", { status: "done", duration: 5400 });
    setTask("t3", { status: "done", duration: 4800 });
    schedule(() => {
      setStep("s5", { status: "done", duration: Date.now() - t2 });
      phase.value = "done";
    }, 1200);
  }, 1300);
}

const statusText = computed(
  () =>
    ({
      idle: "点击「开始运行」，看 agent 的完整工作流",
      running: "agent 正在工作…",
      "waiting-approval": "⚠ agent 在等你批准安装依赖",
      error: "构建失败了——在工具卡上点「重试」恢复流程",
      done: "✅ 全部完成",
    })[phase.value],
);
</script>

<template>
  <div class="run">
    <div class="run__bar">
      <VaButton size="sm" :disabled="phase === 'running' || phase === 'waiting-approval'" @click="start">
        ▶ 开始运行
      </VaButton>
      <VaButton size="sm" variant="secondary" :disabled="phase === 'idle'" @click="reset">重置</VaButton>
      <span class="run__status" :data-phase="phase">{{ statusText }}</span>
    </div>

    <div class="run__grid">
      <div class="run__col">
        <div class="run__panel">
          <h3>执行计划</h3>
          <VaAgentPlan :steps="planSteps" :editable="phase === 'idle'" @retry="onToolRetry" />
        </div>

        <div class="run__panel">
          <h3>审批门</h3>
          <VaApprovalCard
            v-if="approvalVisible"
            title="agent 想安装新的开发依赖"
            detail="vitest · 来自官方 registry，用于步骤 4 的构建验证"
            risk="high"
            preview="pnpm add -D vitest@^3.2.4"
            :countdown="30"
            @approve="onApprove"
            @deny="onDeny"
          />
          <p v-else class="run__hint">运行到安装依赖的步骤时，agent 会在这里请求批准。</p>
        </div>

        <div class="run__panel">
          <h3>工具调用</h3>
          <div class="run__tools">
            <VaToolCallCard
              v-for="t in startedTools"
              :key="t.name"
              :name="t.name"
              :summary="t.summary"
              :status="t.status"
              :args="t.args"
              :result="t.result"
              :error="t.error"
              :started-at="t.startedAt"
              :duration="t.duration"
              :max-code-height="140"
              @retry="onToolRetry"
            />
          </div>
          <p v-if="!startedTools.length" class="run__hint">运行后，agent 的每次工具调用会以卡片形式出现在这里。</p>
        </div>

        <div class="run__panel">
          <h3>业务决策</h3>
          <VaDecisionInbox :decisions="decisions" />
        </div>
      </div>

      <div class="run__col">
        <div class="run__panel">
          <h3>上下文窗口</h3>
          <VaContextWindow
            :parts="contextParts"
            :capacity="32_000"
            :compacting="compacting"
            @remove="(p) => (contextParts = contextParts.filter((x) => x.id !== p.id))"
            @compact="compact"
          />
        </div>

        <div class="run__panel">
          <h3>任务收件箱</h3>
          <VaAgentInbox
            :tasks="tasks"
            @open="() => {}"
            @retry="() => {}"
            @cancel="(t) => setTask(t.id, { status: 'error', error: '已被你取消' })"
          />
        </div>

        <div class="run__panel">
          <h3>文案微调（Inline Diff）</h3>
          <VaInlineDiff :original="diffOriginal" :revised="diffRevised" title="Hero 副标题" @apply="(r) => (diffApplied = r)" />
          <p v-if="diffApplied" class="run__applied">已应用：「{{ diffApplied }}」</p>
        </div>

        <div class="run__panel">
          <h3>记忆面板</h3>
          <VaMemoryPanel v-model:enabled="memEnabled" :memories="memories" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.run__bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.run__status { font-size: 13px; color: var(--va-muted, #6f6d66); }
.run__status[data-phase="waiting-approval"] { color: var(--va-warning, #b45309); font-weight: 600; }
.run__status[data-phase="error"] { color: var(--va-danger, #d5453c); font-weight: 600; }
.run__status[data-phase="done"] { color: var(--va-success, #1a7f4b); font-weight: 600; }

.run__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
  align-items: start;
}
.run__col { display: grid; gap: 16px; min-width: 0; }

.run__panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  min-width: 0;
}
.run__panel h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--va-muted, #6f6d66);
}
.run__hint { margin: 0; font-size: 12.5px; color: var(--va-muted, #6f6d66); }
.run__tools { display: grid; gap: 6px; }
.run__applied { margin: 10px 0 0; font-size: 12.5px; color: var(--va-success, #1a7f4b); }
</style>
