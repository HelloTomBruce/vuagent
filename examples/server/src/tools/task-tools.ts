import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/**
 * 场景⑤ 后台任务管家：启动批量回填任务
 * 返回 ui_task_inbox 卡片（内嵌 VaAgentInbox 后台任务收件箱）
 */
export const TaskStartBackfillTool: HarnessTool = {
  name: "task_start_backfill",
  description: "启动一个后台批量数据回填任务集群（8 分片并行），返回任务收件箱卡片",
  parameters: Type.Object({
    dataset: Type.Optional(Type.String({ description: "目标数据集，例如 orders_2025" })),
  }),
  riskLevel: "medium",
  requiresApproval: false,
  writesWorkspace: true,
  execute: async (ctx) => {
    const dataset = String(ctx.args.dataset || "orders_2025");
    const now = Date.now();
    return {
      rendered: true,
      component: "ui_task_inbox",
      props: {
        dataset,
        tasks: [
          {
            id: "bf-1",
            title: `分片回填 shard-1..3（${dataset}）`,
            agent: "backfill-worker",
            status: "running",
            startedAt: now - 42_000,
            steps: ["拉取分片清单 8/8", "写入临时表 orders_staging", "校验行数一致"],
          },
          {
            id: "bf-2",
            title: "脏数据修复（枚举值越界）",
            agent: "repair-worker",
            status: "error",
            startedAt: now - 61_000,
            duration: 9_800,
            error: "行 40211 的 order_channel 枚举值越界：'wx_mini_pro'",
          },
          {
            id: "bf-3",
            title: "主键冲突重放（order_no 去重）",
            agent: "backfill-worker",
            status: "queued",
          },
          {
            id: "bf-4",
            title: "历史索引重建 orders_v2",
            agent: "index-worker",
            status: "done",
            startedAt: now - 320_000,
            duration: 183_000,
            steps: ["build inverted index", "swap alias", "warm cache"],
          },
          {
            id: "bf-5",
            title: "全量一致性校验",
            agent: "audit-worker",
            status: "waiting",
            steps: ["等待 shard-1..3 完成后触发"],
          },
        ],
      },
    };
  },
};

/**
 * 场景⑤ 后台任务管家：实时跟踪任务日志
 * 返回 ui_task_log 卡片（内嵌 VaTerminalLog，ANSI 着色）
 */
export const TaskTailLogTool: HarnessTool = {
  name: "task_tail_log",
  description: "跟踪指定后台回填任务的实时日志流（返回终端日志卡片）",
  parameters: Type.Object({
    taskId: Type.Optional(Type.String({ description: "任务 id，缺省跟踪最新回填集群" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const taskId = String(ctx.args.taskId || "bf-1");
    const t = "\u001b[90m10:24:\x1b[0m";
    return {
      rendered: true,
      component: "ui_task_log",
      props: {
        title: `backfill ${taskId} — tail -f`,
        lines: [
          `${t}01 worker-3 领取分片 \u001b[36mshard-5\u001b[0m（offset 88213 起）`,
          `${t}02 \u001b[32m✓\u001b[0m shard-5 写入 \u001b[32m12,804 行\u001b[0m（1.8s，速率 7,113 行/s）`,
          `${t}04 worker-1 领取分片 \u001b[36mshard-6\u001b[0m`,
          `${t}05 \u001b[33m⚠\u001b[0m shard-6 跳过 3 行脏数据（order_channel 枚举越界，已落 reject 表）`,
          `${t}09 \u001b[31m✗\u001b[0m shard-7 主键冲突 order_no=\u001b[31mSO-20260912-0042\u001b[0m → 转入重放队列`,
          `${t}12 \u001b[36m[进度]\u001b[0m 128/1024 批 · 累计 1,082,912 行 · 速率 \u001b[32m4,210 行/s\u001b[0m · ETA 04:12`,
          `${t}15 worker-2 心跳正常（内存 412MB / CPU 36%）`,
          `${t}18 \u001b[32m✓\u001b[0m 分片校验 shard-1..4 全部通过，开始合并临时表`,
        ],
      },
    };
  },
};

export const taskTools = [TaskStartBackfillTool, TaskTailLogTool];
