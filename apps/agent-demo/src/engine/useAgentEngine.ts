/**
 * mock 引擎：module 单例 reactive store（全部页面共享的单一数据源）。
 * dispatch(用户输入) → 关键词路由剧本 → 逐事件 delay 推进应用 reducer；
 * approval 事件挂起等待用户决策（approve 续跑 / deny 中止）。
 * 纯客户端（demo 无 SSR 场景），Date.now/setTimeout 直用。
 */
import { reactive, ref } from "vue";
import type { EngineState, Scenario, ScenarioEvent } from "./types";
import { SCENARIOS, FALLBACK_SCENARIO } from "./scenarios";

let seed = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seed++}`;

function initialState(): EngineState {
  return {
    messages: [
      {
        id: "welcome",
        role: "agent",
        kind: "text",
        text: "你好，我是你的通用助手。试试：\n· 「生成周报」 — 查提交记录写周报\n· 「重构用户列表页」 — 走计划/审批/改代码全流程\n· 「分析任务数据」 — 数据对比与图表",
        at: Date.now(),
      },
    ],
    busy: false,
    pendingApproval: null,
    model: "claude-sonnet",
    plan: [],
    tasks: [],
    checkpoints: [],
    changeSummary: null,
    diff: null,
    tree: [],
    terminal: [],
    usage: {
      segments: [
        { label: "Fast tokens", used: 412_000 },
        { label: "Slow tokens", used: 168_500 },
      ],
      limit: 800_000,
    },
    kpis: {
      runs: { label: "今日运行", value: 1284, delta: 0.12, series: [8, 11, 9, 14, 13, 17, 16, 19] },
      done: { label: "完成任务", value: 963, delta: 0.08, series: [5, 7, 6, 9, 11, 10, 13, 14] },
      fail: {
        label: "失败率",
        value: 0.021,
        format: { style: "percent", maximumFractionDigits: 1 },
        delta: -0.35,
        invertDelta: true,
        series: [8, 7, 6, 6, 4, 4, 3, 2],
      },
    },
    breakdown: [
      { label: "代码审查", value: 412 },
      { label: "构建", value: 318 },
      { label: "测试", value: 186 },
      { label: "文档", value: 84 },
      { label: "其他", value: 32 },
    ],
    experiment: null,
    notifications: [
      { id: "n1", title: "额度已重置", kind: "success", createdAt: Date.now() - 5 * 3_600_000 },
    ],
    promptDraft: "",
  };
}

const state = reactive(initialState());

/* ---------- 剧本路由（纯函数，单独导出便于测试） ---------- */

export function matchScenario(text: string, scenarios: Scenario[] = SCENARIOS): Scenario | null {
  const t = text.toLowerCase();
  for (const s of scenarios) {
    if (s.keywords.some((k) => t.includes(k.toLowerCase()))) return s;
  }
  return FALLBACK_SCENARIO;
}

/* ---------- 时间线执行 ---------- */

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** approval 决策通道 */
let approvalResolve: ((ok: boolean) => void) | null = null;

async function applyEvent(ev: ScenarioEvent) {
  switch (ev.t) {
    case "thinking":
      state.messages.push({ id: uid("m"), role: "agent", kind: "thinking", label: ev.label, at: Date.now() });
      await sleep(ev.ms);
      break;

    case "tool": {
      const msg = reactive({
        id: uid("m"),
        role: "agent",
        kind: "tools",
        calls: [{ name: ev.name, summary: ev.summary, status: "running", ms: ev.ms }],
        at: Date.now(),
      }) as Extract<EngineState["messages"][number], { kind: "tools" }>;
      state.messages.push(msg);
      await sleep(ev.ms);
      msg.calls[0]!.status = "success";
      if (ev.result !== undefined) msg.calls[0]!.result = ev.result;
      break;
    }

    case "plan":
      state.plan = ev.steps.map((s, i) => ({ ...s, status: i === 0 ? "running" : "pending" }));
      break;

    case "approval": {
      state.pendingApproval = { title: ev.title, preview: ev.preview, risk: ev.risk, countdown: ev.countdown };
      const ok = await new Promise<boolean>((resolve) => {
        approvalResolve = resolve;
      });
      approvalResolve = null;
      state.pendingApproval = null;
      if (!ok) throw new Error("denied");
      break;
    }

    case "stream": {
      const cps = ev.cps ?? 40;
      const msg = reactive({ id: uid("m"), role: "agent", kind: "text", text: "", at: Date.now() }) as Extract<
        EngineState["messages"][number],
        { kind: "text" }
      >;
      state.messages.push(msg);
      for (let i = 0; i < ev.text.length; i += Math.max(1, Math.round(cps / 20))) {
        msg.text = ev.text.slice(0, i + Math.max(1, Math.round(cps / 20)));
        await sleep(50);
      }
      msg.text = ev.text;
      break;
    }

    case "answer":
      state.messages.push({ id: uid("m"), role: "agent", kind: "answer", text: ev.text, sources: ev.sources, at: Date.now() });
      break;

    case "recommend":
      state.messages.push({
        id: uid("m"),
        role: "agent",
        kind: "recommend",
        title: ev.title,
        description: ev.description,
        impact: ev.impact,
        at: Date.now(),
      });
      break;

    case "checkpoint": {
      state.checkpoints.unshift({
        id: uid("cp"),
        label: ev.label,
        createdAt: Date.now(),
        files: ev.files,
        additions: ev.additions,
        deletions: ev.deletions,
        current: true,
      });
      state.checkpoints = state.checkpoints.map((c, i) => ({ ...c, current: i === 0 }));
      break;
    }

    case "diff":
      state.diff = { file: ev.file, oldText: ev.oldText, newText: ev.newText };
      break;

    case "tree":
      state.tree = ev.changes;
      break;

    case "terminal":
      state.terminal = [...state.terminal, ...ev.lines];
      break;

    case "summary":
      state.changeSummary = { files: ev.files, durationMs: ev.durationMs, toolCalls: ev.toolCalls };
      state.tasks = state.tasks.map((t) =>
        t.status === "running" ? { ...t, status: "done", duration: ev.durationMs } : t,
      );
      break;

    case "task":
      state.tasks = [ev.task, ...state.tasks];
      break;

    case "usage": {
      const seg = state.usage.segments.find((s) => s.label === ev.segment);
      if (seg) seg.used = Math.min(state.usage.limit, seg.used + ev.add);
      break;
    }

    case "kpi": {
      const k = state.kpis[ev.key];
      k.series = [...k.series, ev.push];
      if (ev.bumpValue !== undefined) k.value = ev.bumpValue;
      if (ev.delta !== undefined) k.delta = ev.delta;
      break;
    }

    case "experiment":
      state.experiment = { title: ev.title, confidence: ev.confidence, a: ev.a.value, b: ev.b.value, bDelta: ev.b.delta };
      break;

    case "notify":
      state.notifications = [{ ...ev.item, id: uid("n"), createdAt: Date.now(), unread: true }, ...state.notifications];
      break;
  }
}

async function runScenario(s: Scenario) {
  const toolCount = s.events.filter((e) => e.t === "tool").length;
  if (toolCount > 0) {
    state.tasks = [
      { id: uid("task"), title: s.id, status: "running", steps: [], startedAt: Date.now() },
      ...state.tasks,
    ];
  }
  try {
    for (const ev of s.events) {
      await applyEvent(ev);
    }
  } catch (e) {
    if ((e as Error).message !== "denied") throw e;
    state.messages.push({
      id: uid("m"),
      role: "agent",
      kind: "text",
      text: "已按你的要求取消操作，未做任何更改。",
      at: Date.now(),
    });
    state.tasks = state.tasks.map((t) => (t.status === "running" ? { ...t, status: "error" } : t));
    return;
  }
  // 计划步全数完成
  if (state.plan.length) {
    state.plan = state.plan.map((p) => (p.status === "error" ? p : { ...p, status: "done", duration: 2_000 }));
  }
}

/* ---------- 对外 API ---------- */

const dispatching = ref(false);

export function useAgentEngine() {
  async function dispatch(text: string) {
    state.messages.push({ id: uid("u"), role: "user", text, at: Date.now() });
    state.busy = true;
    dispatching.value = true;
    try {
      await runScenario(matchScenario(text)!);
    } finally {
      state.busy = false;
      dispatching.value = false;
    }
  }

  /** 审批决策（approve 续跑 / deny 中止） */
  function decideApproval(ok: boolean) {
    approvalResolve?.(ok);
  }

  /** PromptLibrary → composer 草稿 */
  function usePrompt(text: string) {
    state.promptDraft = text;
  }

  function markAllRead() {
    state.notifications = state.notifications.map((n) => ({ ...n, unread: false }));
  }

  function markRead(id: string) {
    state.notifications = state.notifications.map((n) => (n.id === id ? { ...n, unread: false } : n));
  }

  /** 恢复检查点（demo：清后续产物） */
  function restoreCheckpoint(id: string) {
    state.checkpoints = state.checkpoints.map((c) => ({ ...c, current: c.id === id }));
    state.changeSummary = null;
    state.diff = null;
  }

  return { state, dispatching, dispatch, decideApproval, usePrompt, markAllRead, markRead, restoreCheckpoint };
}
