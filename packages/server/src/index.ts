import { serve } from "@hono/node-server";
import { createHarnessServer } from "./server.js";
import { resolveBindPlan } from "./security.js";

export * from "./core/types.js";
export * from "./core/action-hub.js";
export * from "./core/tool-registry.js";
export * from "./core/ui-registry.js";
export * from "./core/system-prompt.js";
export * from "./core/stream-orchestrator.js";
export * from "./core/telemetry.js";
export * from "./core/context-compactor.js";
export * from "./core/config-schema.js";
export * from "./core/config-resolver.js";
export * from "./core/agent-loop.js";
export * from "./core/recovery.js";
export * from "./core/event-sink.js";
export * from "./core/pricing-table.js";
export * from "./storage/repositories/cost-record.repository.js";
export * from "./adapters/model-driver.js";
export * from "./adapters/openai-driver.js";
export * from "./adapters/anthropic-driver.js";
export * from "./adapters/resilience.js";
export * from "./storage/interfaces.js";
export * from "./storage/keys.js";
export * from "./core/endpoint-headers.js";
export * from "./storage/paths.js";
export * from "./storage/drivers/base.driver.js";
export * from "./storage/drivers/memory.driver.js";
export * from "./storage/drivers/sqlite.driver.js";
export * from "./storage/repositories/workspace.repository.js";
export * from "./storage/repositories/session.repository.js";
export { CheckpointRepository, CHECKPOINTS_COLLECTION } from "./storage/repositories/checkpoint.repository.js";
export * from "./storage/repositories/settings.repository.js";
export * from "./storage/repositories/tool-config.repository.js";
export * from "./storage/repositories/harness-config.repository.js";
export * from "./security.js";
export * from "./server.js";

// 如果直接通过 node 执行本文件，启动 HTTP 监听
const entryFile = process.argv[1]?.replace(/\\/g, "/") || "";
const isDirectRun =
  entryFile.endsWith("packages/server/src/index.ts") ||
  entryFile.endsWith("packages/server/dist/index.js");

if (isDirectRun) {
  const port = Number(process.env.PORT) || 6880;
  const dbPath = process.env.DB_PATH || ".vuagent/harness.db";

  // 绑定闸门（TASK-085）：默认 127.0.0.1；对外绑定需 VUAGENT_TOKEN 或显式豁免，否则拒绝启动
  const bind = resolveBindPlan();
  if (bind.refused) {
    console.error(bind.refusalReason);
    process.exit(1);
  }

  // Redis 分布式形态（可选）：REDIS_URL 配置后存储实体共享 + 跨副本轮次租约
  const bootstrap = async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return {};
    const { createRedisLikeFromUrl } = await import("./storage/drivers/redis.driver.js");
    const client = await createRedisLikeFromUrl(redisUrl);
    console.log(`[Vuagent Harness Server] Redis 形态启用：${redisUrl}`);
    return { redisClient: client };
  };

  void bootstrap()
    .then((redisOptions) => {
      const harness = createHarnessServer({ dbPath, ...redisOptions });
      if (bind.unsafeExempted) {
        console.warn(
          `[Vuagent Harness Server] ⚠️ 安全豁免生效：监听 ${bind.host} 且未配置 VUAGENT_TOKEN——` +
            `本机执行权暴露给网络可达者，仅限隔离网络使用。`
        );
      }
      console.log(`[Vuagent Harness Server] Starting on http://${bind.host}:${port}...`);
      const server = serve({
        fetch: harness.app.fetch,
        port,
        hostname: bind.host,
      });

      // 优雅停机（TASK-095）：SIGTERM/SIGINT → 停受理新连接 → 等待在途轮次抽干
      // （上限 20s，超时由恢复机制诚实标记 process_restart）→ 关闭存储 → 退出；
      // 二次信号立即强杀。容器编排（k8s terminationGracePeriodSeconds / docker stop）按此预算配置。
      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) process.exit(1);
        shuttingDown = true;
        console.log(
          `[Vuagent Harness Server] 收到 ${signal}：停受理新请求，等待在途轮次抽干（上限 20s）...`
        );
        server.close();
        const deadline = Date.now() + 20_000;
        while (harness.executionHub.runningCount() > 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250));
        }
        const runningLeft = harness.executionHub.runningCount();
        if (runningLeft > 0) {
          console.warn(
            `[Vuagent Harness Server] 抽干超时：仍有 ${runningLeft} 轮在途，其状态由恢复机制诚实标记`
          );
        }
        await harness.close();
        // Redis 客户端关闭（createRedisLikeFromUrl 返回 ioredis 原生实例，运行时带 quit）
        const redisClient = (redisOptions as { redisClient?: { quit?: () => Promise<unknown> } })
          .redisClient;
        await redisClient?.quit?.().catch(() => {});
        process.exit(0);
      };
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
    })
    .catch((err) => {
      console.error("[Vuagent Harness Server] 启动失败：", err);
      process.exit(1);
    });
}
