#!/usr/bin/env node
/**
 * 发布计划解析（Publish workflow 的 plan 阶段；本地也可直接跑）。
 *
 * 用法：
 *   node scripts/release-plan.mjs [--channel auto|next|latest] [--tag v0.7.0-alpha.1] [--json|--github-output]
 *
 * 规则（判定逻辑在 scripts/lib/release-plan.mjs，纯函数可单测）：
 *  - 版本一致性：所有可发布包版本必须相同（changesets fixed 组）；
 *  - dist-tag：auto = 版本串含 `-` → next，否则 latest；显式指定以参数为准；
 *  - 安全阀：预发布版本不允许发到 latest；
 *  - tag 校验：传了 --tag（CI 的 push tag 触发）时必须等于 `v<version>`，防「tag 与包版本不一致」的错发。
 *
 * --github-output 输出 `key=value` 行（供 `>> $GITHUB_OUTPUT`）；默认输出 JSON。
 */
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./lib/workspace-packages.mjs";
import { resolvePlan, ReleasePlanError } from "./lib/release-plan.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? fallback : fallback;
};
const channelArg = getArg("--channel", "auto").trim() || "auto";
const tagArg = getArg("--tag", "").trim();
const githubOutput = args.includes("--github-output");
const asJson = args.includes("--json") || !githubOutput;

let plan;
try {
  plan = resolvePlan({
    packages: publishablePackages(ROOT).map((p) => ({ name: p.pkg.name, version: p.pkg.version })),
    channelArg,
    tag: tagArg,
  });
} catch (err) {
  if (err instanceof ReleasePlanError) {
    console.error(`✗ 发布计划拒绝：${err.message}`);
    process.exit(1);
  }
  throw err;
}

const hasCli = plan.packages.some((p) => p.name === "@vuagent/cli");
const summary =
  `发布计划：${plan.packages.map((p) => `${p.name}@${p.version}`).join(" ")} → dist-tag「${plan.channel}」` +
  (plan.tagValidated ? `（tag ${plan.tagValidated} 校验通过）` : "");

if (githubOutput) {
  // $GITHUB_OUTPUT 只接受单行 key=value
  console.log(
    [
      `version=${plan.version}`,
      `channel=${plan.channel}`,
      `prerelease=${plan.prerelease}`,
      `has_cli=${hasCli}`,
      `packages=${plan.packages.map((p) => p.name).join(",")}`,
    ].join("\n"),
  );
  console.error(summary);
} else if (asJson) {
  console.log(JSON.stringify({ ...plan, hasCli }, null, 2));
}
