#!/usr/bin/env node
/**
 * 协议类型同步卡口（TASK-056）：
 * 对比 @vuagent/protocol（lifecycle.ts + events.ts）导出的类型名与
 * @vuagent/ui vendored 副本（runtime/protocol-types.ts），不一致即失败。
 *
 * 背景：@vuagent/ui 以 npm 包分发时必须自包含（零 workspace 依赖），
 * 契约类型以内联副本随包分发，历史上靠人工同步——本脚本把同步变成 CI 卡口。
 *
 * 对比维度：
 * 1. 导出类型/接口名集合（两侧必须一致；协议侧的守卫函数不在对比范围）
 * 2. AgentComponentStatus 的字面量成员（四态生命周期漂移即失败）
 *
 * 用法：node scripts/check-protocol-sync.mjs（或 pnpm protocol:sync-check）
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function exportedTypeNames(filePath) {
  const src = readFileSync(filePath, "utf-8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)) {
    names.add(m[1]);
  }
  return names;
}

function statusLiterals(filePath) {
  const src = readFileSync(filePath, "utf-8");
  const m = src.match(
    /export type AgentComponentStatus\s*=\s*([^;]+);/
  );
  if (!m) return null;
  return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort().join("|");
}

const protocolFiles = [
  join(root, "packages/protocol/src/lifecycle.ts"),
  join(root, "packages/protocol/src/events.ts"),
];
const vendoredFile = join(root, "packages/ui/src/runtime/protocol-types.ts");

const protocolNames = new Set();
for (const f of protocolFiles) {
  for (const n of exportedTypeNames(f)) protocolNames.add(n);
}
const vendoredNames = exportedTypeNames(vendoredFile);

const errors = [];

// 1. 名集合一致性
const missingInVendored = [...protocolNames].filter((n) => !vendoredNames.has(n));
const extraInVendored = [...vendoredNames].filter((n) => !protocolNames.has(n));
if (missingInVendored.length > 0) {
  errors.push(
    `protocol 导出但 ui vendored 副本缺失: ${missingInVendored.join(", ")}\n` +
      `  → 请在 packages/ui/src/runtime/protocol-types.ts 同步内联这些类型`
  );
}
if (extraInVendored.length > 0) {
  errors.push(
    `ui vendored 副本存在但 protocol 已不含: ${extraInVendored.join(", ")}\n` +
      `  → 请从 packages/ui/src/runtime/protocol-types.ts 移除（或确认 protocol 侧误删）`
  );
}

// 2. AgentComponentStatus 字面量成员
const protocolStatus = statusLiterals(protocolFiles[0]);
const vendoredStatus = statusLiterals(vendoredFile);
if (protocolStatus !== vendoredStatus) {
  errors.push(
    `AgentComponentStatus 字面量漂移:\n` +
      `  protocol: ${protocolStatus}\n` +
      `  vendored: ${vendoredStatus}`
  );
}

if (errors.length > 0) {
  console.error("[protocol-sync] 契约副本不同步：\n");
  for (const e of errors) console.error(`  ✗ ${e}\n`);
  process.exit(1);
}

console.log(
  `[protocol-sync] OK：${protocolNames.size} 个契约类型名与 AgentComponentStatus(${protocolStatus}) 两侧一致`
);
