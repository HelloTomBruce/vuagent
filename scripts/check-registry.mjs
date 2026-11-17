#!/usr/bin/env node
/**
 * 校验已生成的 registry 工件自包含性（TASK-009）。
 * 防手改/防回归：每条 item 的任何相对 import 必须可由「条目自身文件 + registryDependencies」解析。
 * 用法：node scripts/check-registry.mjs（CI 与 pnpm registry:check）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkItemSelfContainment } from "./registry-rules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = path.join(ROOT, "packages/ui/registry");

let bad = 0;
const entries = fs
  .readdirSync(OUT_DIR)
  .filter((f) => f.endsWith(".json") && f !== "index.json")
  .map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")));
// 全局 target 并集：校验组件间引用的文件确实随依赖条目分发
const globalTargets = new Set(entries.flatMap((item) => item.files.map((f) => f.target)));

for (const item of entries) {
  const problems = checkItemSelfContainment(item, globalTargets);
  if (problems.length) {
    bad++;
    console.error(`✗ ${item.name}.json\n` + problems.map((p) => `    ${p}`).join("\n"));
  }
}
if (bad > 0) {
  console.error(`\n${bad} 个条目存在未随包携带的相对引用 —— 共享 composables/utils 需内联，组件间依赖需声明 registryDependencies`);
  process.exit(1);
}
console.log(`✓ registry 自包含检查通过（${fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json") && f !== "index.json").length} 个条目）`);
