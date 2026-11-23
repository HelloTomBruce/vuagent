import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createHarnessServer } from "@vuagent/server";
import { opsTools } from "./tools/ops-tools.js";

const port = Number(process.env.PORT) || 6881;

// 默认定位并复用 Console 服务端在 packages/server/.vuagent/harness.db 的数据库
// 使得在 Console 中配置好的模型 Profile、API Key、供应商配置全部开箱即用，无需重新配置！
const defaultSharedDbPath = fileURLToPath(
  new URL("../../../packages/server/.vuagent/harness.db", import.meta.url)
);
const dbPath = process.env.DB_PATH || defaultSharedDbPath;

// 收集所有案例所需的自定义场景工具
const exampleSceneTools = [
  ...opsTools,
  // 随着新案例的增加，可在下方继续扩展注册其它案例 tools
];

const { app } = createHarnessServer({
  dbPath,
  customTools: exampleSceneTools,
  security: {
    // 允许前端覆盖或者自备模型
    allowByoProvider: true,
    extraOrigins: [
      "http://localhost:6991",
      "http://127.0.0.1:6991",
      "http://localhost:6995",
      "http://127.0.0.1:6995",
    ],
  },
});

console.log(`[Vuagent Examples Server] 启动中... http://localhost:${port}`);
console.log(`[Vuagent Examples Server] 共享模型配置数据库: ${dbPath}`);
console.log(`[Vuagent Examples Server] 场景自定义工具已就绪: ${exampleSceneTools.map((t) => t.name).join(", ")}`);

serve({
  fetch: app.fetch,
  port,
});
