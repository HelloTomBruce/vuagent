import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/**
 * 场景⑤ 后台任务管家 —— 有状态仿真：
 * 回填集群启动后进入模块级状态，后续 start/tail/repair 调用基于真实流逝时间
 * 演进进度与日志——隔几秒再查，内容不一样，卡片是「活」的。
 */
const state = {
  startedAt: null as number | null,
  dataset: "orders_2025",
  repairs: 0,
};

const TOTAL_BATCHES = 1024;

function elapsedSec(): number {
  return state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
}

function doneBatches(): number {
  // 速率约 34 批/秒（演示节奏），封顶 TOTAL_BATCHES
  return Math.min(TOTAL_BATCHES, Math.floor(elapsedSec() * 34));
}

function buildTasks() {
  const sec = elapsedSec();
  const done = doneBatches();
  const pct = Math.round((done / TOTAL_BATCHES) * 100);
  const now = Date.now();

  const tasks: Array<Record<string, any>> = [
    {
      id: "bf-1",
      title: `分片回填 shard-1..3（${state.dataset}）`,
      agent: "backfill-worker",
      status: done >= TOTAL_BATCHES ? "done" : "running",
      startedAt: state.startedAt ?? now,
      duration: done >= TOTAL_BATCHES ? sec * 1000 : undefined,
      steps:
        done >= TOTAL_BATCHES
          ? ["拉取分片清单 8/8", `合并临时表（${TOTAL_BATCHES} 批）`, "行数校验一致"]
          : [`写入进度 ${done}/${TOTAL_BATCHES} 批（${pct}%）`, "行数校验滚动比对中", `预计剩余 ${Math.max(0, Math.ceil((TOTAL_BATCHES - done) / 34))}s`],
    },
    {
      id: "bf-2",
      title: "脏数据修复（枚举值越界）",
      agent: "repair-worker",
      status: state.repairs > 0 ? "done" : sec >= 5 ? "error" : "queued",
      startedAt: state.startedAt ? state.startedAt + 5_000 : now,
      duration: state.repairs > 0 ? 9_800 : sec >= 5 ? 9_800 : undefined,
      steps: state.repairs > 0 ? [`已修复并重放 ${state.repairs} 批`, "reject 表已清空"] : undefined,
      error:
        state.repairs > 0
          ? undefined
          : sec >= 5
            ? "行 40211 的 order_channel 枚举值越界：'wx_mini_pro'"
            : undefined,
    },
    {
      id: "bf-3",
      title: "主键冲突重放（order_no 去重）",
      agent: "backfill-worker",
      status: done >= TOTAL_BATCHES * 0.5 ? "running" : "queued",
      startedAt: done >= TOTAL_BATCHES * 0.5 ? now - 8_000 : undefined,
      steps: done >= TOTAL_BATCHES * 0.5 ? ["冲突批次 12/58 已重放"] : undefined,
    },
    {
      id: "bf-4",
      title: "历史索引重建 orders_v2",
      agent: "index-worker",
      status: "done",
      startedAt: state.startedAt ? state.startedAt - 320_000 : now - 320_000,
      duration: 183_000,
      steps: ["build inverted index", "swap alias", "warm cache"],
    },
    {
      id: "bf-5",
      title: "全量一致性校验",
      agent: "audit-worker",
      status: done >= TOTAL_BATCHES ? "running" : "waiting",
      startedAt: done >= TOTAL_BATCHES ? now - 3_000 : undefined,
      steps: done >= TOTAL_BATCHES ? ["抽查 3 表行数与聚合值", "比对业务对账快照"] : ["等待 shard-1..3 完成后触发"],
    },
  ];
  return tasks;
}

/**
 * 场景⑤ 后台任务管家：启动批量回填任务集群（有状态——重复调用返回演进后的进度）
 */
export const TaskStartBackfillTool: HarnessTool = {
  name: "task_start_backfill",
  description: "启动一个后台批量数据回填任务集群（8 分片并行）。任务在后台持续运行，可随时再次调用本工具查看最新进度，或调用 task_tail_log 跟踪实时日志。",
  parameters: Type.Object({
    dataset: Type.Optional(Type.String({ description: "目标数据集，例如 orders_2025" })),
    restart: Type.Optional(Type.Boolean({ description: "是否重置并重新开始（缺省复用已运行集群的实时进度）" })),
  }),
  riskLevel: "medium",
  requiresApproval: false,
  writesWorkspace: true,
  execute: async (ctx) => {
    const dataset = String(ctx.args.dataset || "orders_2025");
    const restart = Boolean(ctx.args.restart);
    if (!state.startedAt || restart || dataset !== state.dataset) {
      state.startedAt = Date.now();
      state.dataset = dataset;
      state.repairs = 0;
    }
    return {
      rendered: true,
      component: "ui_task_inbox",
      props: { dataset: state.dataset, live: true, tasks: buildTasks() },
    };
  },
};

/**
 * 场景⑤ 后台任务管家：实时跟踪任务日志（日志随真实时间增长）
 */
export const TaskTailLogTool: HarnessTool = {
  name: "task_tail_log",
  description: "跟踪回填任务集群的实时日志。日志随任务推进持续增长——间隔数秒再次调用可看到新内容与进度变化。",
  parameters: Type.Object({
    taskId: Type.Optional(Type.String({ description: "任务 id，缺省跟踪回填集群主任务" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    if (!state.startedAt) {
      // 未启动过：引导先启动，保持状态机诚实
      return {
        rendered: true,
        component: "ui_task_log",
        props: {
          title: "backfill — idle",
          verdict: "未启动",
          lines: ["\u001b[33m⚠ 尚无运行中的回填集群，请先调用 task_start_backfill 启动。\u001b[0m"],
        },
      };
    }

    const sec = elapsedSec();
    const done = doneBatches();
    const pct = Math.round((done / TOTAL_BATCHES) * 100);
    const taskId = String(ctx.args.taskId || "bf-1");
    const t = (s: number) => `\u001b[90m+${String(s).padStart(3, "0")}s\x1b[0m`;
    const G = "\u001b[32m";
    const R = "\u001b[31m";
    const Y = "\u001b[33m";
    const C = "\u001b[36m";
    const X = "\u001b[0m";

    const lines: string[] = [
      `${t(0)} 回填集群启动：${state.dataset} · 8 分片 · 批大小 512 行`,
      `${t(1)} worker-1..3 就绪，领取 shard-1..3`,
    ];
    if (sec >= 4) lines.push(`${t(4)} ${G}✓${X} shard-1 写入 12,804 行（1.8s，速率 7,113 行/s）`);
    if (sec >= 6) lines.push(`${t(6)} ${G}✓${X} shard-2 写入 11,452 行（2.1s）`);
    if (sec >= 8) lines.push(`${t(8)} ${Y}⚠${X} shard-3 发现脏数据：order_channel 枚举越界（'wx_mini_pro'）→ 落入 reject 表`);
    if (sec >= 12) lines.push(`${t(12)} ${R}✗${X} 主键冲突 order_no=${R}SO-20260912-0042${X} → 转入重放队列 bf-3`);
    if (sec >= 15) lines.push(`${t(15)} ${C}[进度]${X} ${done}/${TOTAL_BATCHES} 批 · 累计 ${(done * 512).toLocaleString()} 行 · 速率 ${G}4,210 行/s${X} · ETA ${Math.max(0, Math.ceil((TOTAL_BATCHES - done) / 34))}s`);
    if (sec >= 20) lines.push(`${t(20)} worker-2 心跳正常（内存 412MB / CPU 36%）`);
    if (sec >= 26) lines.push(`${t(26)} shard-4..6 并发写入中，无失败批次`);
    if (sec >= 32) lines.push(`${t(32)} ${C}[进度]${X} ${done}/${TOTAL_BATCHES} 批（${pct}%）· 分片校验 shard-1..6 通过`);
    if (sec >= 40) lines.push(`${t(40)} 开始合并临时表 orders_staging → orders_v2`);
    if (done >= TOTAL_BATCHES) {
      lines.push(`${t(sec)} ${G}✔ 回填完成${X}：共 ${TOTAL_BATCHES} 批 · ${(TOTAL_BATCHES * 512).toLocaleString()} 行 · 总耗时 ${sec}s`);
      lines.push(`${t(sec)} 一致性校验 bf-5 已自动触发`);
    }
    if (state.repairs > 0) {
      lines.push(`${t(sec)} ${G}✓${X} 脏数据修复任务已重放 ${state.repairs} 批，reject 表清空`);
    }

    return {
      rendered: true,
      component: "ui_task_log",
      props: { title: `backfill ${taskId} — tail -f（${sec}s）`, verdict: `${pct}%`, lines },
    };
  },
};

/**
 * 场景⑤ 后台任务管家：修复失败任务（演示收件箱状态随操作演进）
 */
export const TaskRepairFailedTool: HarnessTool = {
  name: "task_repair_failed",
  description: "修复回填集群中失败的任务（重放脏数据批次），返回修复后的收件箱状态",
  parameters: Type.Object({}),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: true,
  execute: async () => {
    if (!state.startedAt) {
      return {
        rendered: false,
        output: "尚无运行中的回填集群，请先调用 task_start_backfill。",
      };
    }
    state.repairs += 1;
    return {
      rendered: true,
      component: "ui_task_inbox",
      props: { dataset: state.dataset, live: true, repairEpoch: state.repairs, tasks: buildTasks() },
    };
  },
};

export const taskTools = [TaskStartBackfillTool, TaskTailLogTool, TaskRepairFailedTool];
