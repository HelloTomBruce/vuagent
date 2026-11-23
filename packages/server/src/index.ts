import { serve } from "@hono/node-server";
import { createHarnessServer } from "./server.js";

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
export * from "./storage/drivers/base.driver.js";
export * from "./storage/drivers/memory.driver.js";
export * from "./storage/drivers/sqlite.driver.js";
export * from "./storage/repositories/workspace.repository.js";
export * from "./storage/repositories/session.repository.js";
export * from "./storage/repositories/settings.repository.js";
export * from "./storage/repositories/tool-config.repository.js";
export * from "./storage/repositories/harness-config.repository.js";
export * from "./security.js";
export * from "./server.js";
export * from "./tools/ops/ops-tools.js";

// 如果直接通过 node 执行本文件，启动 HTTP 监听
const isDirectRun =
  process.argv[1]?.endsWith("src/index.ts") || process.argv[1]?.endsWith("dist/index.js");

if (isDirectRun) {
  const port = Number(process.env.PORT) || 3001;
  const dbPath = process.env.DB_PATH || ".vuagent/harness.db";

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
      const { app } = createHarnessServer({ dbPath, ...redisOptions });
      console.log(`[Vuagent Harness Server] Starting on http://localhost:${port}...`);
      serve({
        fetch: app.fetch,
        port,
      });
    })
    .catch((err) => {
      console.error("[Vuagent Harness Server] 启动失败：", err);
      process.exit(1);
    });
}
