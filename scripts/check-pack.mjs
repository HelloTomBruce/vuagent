#!/usr/bin/env node
/**
 * 发布包内容审查（本地与 CI 同一把尺，0.7.0 发布链门禁）。
 *
 * 用法：node scripts/check-pack.mjs [--json] [--cache <npm cache dir>]
 *   --cache  本机 ~/.npm 权限异常时指定临时缓存目录（CI 不需要）
 *
 * 规则（宁可发布失败，也不要把不该发的东西发出去）：
 *  1. 只审 workspace 内「可发布」包（非 private 且 name 以 @vuagent/ 开头）；
 *  2. 版本一致性：所有可发布包版本必须相同（changesets fixed 组口径）；
 *  3. 禁止内容：node_modules/、.env*、.changeset/、tests/、*.spec.*、coverage/；
 *  4. src/ 默认禁止，仅允许 `src/styles/`（@vuagent/ui 的 files 白名单口径）；
 *  5. 入口存在性：main / exports["."] 指向的文件必须真的在包里；
 *  6. bin：声明的目标文件必须在包里且首行是 shebang（否则安装后不可执行）；
 *  7. console 包（存在时）：必须含 dist/index.html。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./lib/workspace-packages.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const cacheIdx = args.indexOf("--cache");
const npmCache = cacheIdx >= 0 ? args[cacheIdx + 1] : "";

/** npm pack --dry-run --json → 文件清单 */
function packFiles(pkgDir) {
  const argv = ["pack", "--dry-run", "--json"];
  if (npmCache) argv.push("--cache", npmCache);
  const raw = execFileSync("npm", argv, {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  const parsed = JSON.parse(raw);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first?.files) throw new Error(`${pkgDir}: npm pack 未返回文件清单`);
  return { files: first.files.map((f) => f.path), size: first.unpackedSize ?? 0, filename: first.filename };
}

const FORBIDDEN = [
  { re: /^node_modules\//, why: "依赖不应随包发布" },
  { re: /(^|\/)\.env(\.|$)/, why: "环境变量文件禁止入库发布" },
  { re: /^\.changeset\//, why: "changesets 元数据不发布" },
  { re: /(^|\/)(tests?|coverage|__tests__)\//, why: "测试与覆盖率产物不发布" },
  { re: /\.(spec|test)\.[cm]?[jt]sx?$/, why: "测试文件不发布" },
];

const problems = [];
const warnings = [];
const rows = [];

const packages = publishablePackages(ROOT);
if (packages.length === 0) {
  console.error("✗ 未发现可发布的 @vuagent/* 包（检查 files/private 字段）");
  process.exit(1);
}

const versions = new Set(packages.map((p) => p.pkg.version));
if (versions.size > 1) {
  problems.push(`版本不一致（changesets fixed 组要求同版本）：${[...versions].join(" / ")}`);
}

for (const { dir, rel, pkg } of packages) {
  let packed;
  try {
    packed = packFiles(dir);
  } catch (err) {
    problems.push(`${pkg.name}: npm pack 失败 → ${String(err.message || err).split("\n")[0]}`);
    continue;
  }

  const set = new Set(packed.files);
  for (const file of packed.files) {
    for (const rule of FORBIDDEN) {
      if (rule.re.test(file)) problems.push(`${pkg.name}: 含禁止内容 ${file}（${rule.why}）`);
    }
    if (file.startsWith("src/") && !file.startsWith("src/styles/")) {
      problems.push(`${pkg.name}: 含源码 ${file}（只允许 src/styles/ 白名单）`);
    }
  }

  // 入口存在性：npm 发布时以 publishConfig 覆盖为准（开发期 main/exports 指向 src/ 是常态）
  const entries = new Set();
  const main = pkg.publishConfig?.main ?? pkg.main;
  if (typeof main === "string") entries.add(main);
  const rootExport = (pkg.publishConfig?.exports ?? pkg.exports)?.["."];
  if (typeof rootExport === "string") entries.add(rootExport);
  else if (rootExport && typeof rootExport === "object") {
    for (const v of Object.values(rootExport)) if (typeof v === "string") entries.add(v);
  }
  for (const entry of entries) {
    const clean = entry.replace(/^\.\//, "");
    if (!set.has(clean)) problems.push(`${pkg.name}: 入口 ${entry} 不在发布内容里`);
  }

  // bin 可执行性
  const bins = typeof pkg.bin === "string" ? { [pkg.name.split("/").pop()]: pkg.bin } : pkg.bin || {};
  for (const [name, target] of Object.entries(bins)) {
    const clean = String(target).replace(/^\.\//, "");
    if (!set.has(clean)) {
      problems.push(`${pkg.name}: bin "${name}" → ${target} 不在发布内容里`);
      continue;
    }
    const abs = path.join(dir, clean);
    const head = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").split("\n")[0] : "";
    if (!head.startsWith("#!")) problems.push(`${pkg.name}: bin "${name}" 缺 shebang（安装后不可执行）`);
  }

  // console 包形态
  if (pkg.name === "@vuagent/console" && !set.has("dist/index.html")) {
    problems.push("@vuagent/console: 缺 dist/index.html（静态托管入口）");
  }
  if (packed.size > 8 * 1024 * 1024) {
    warnings.push(`${pkg.name}: 包体 ${(packed.size / 1048576).toFixed(1)} MB，确认是否预期`);
  }

  rows.push({
    name: pkg.name,
    version: pkg.version,
    dir: rel,
    files: packed.files.length,
    sizeMB: +(packed.size / 1048576).toFixed(2),
    tarball: packed.filename,
  });
}

if (asJson) {
  console.log(JSON.stringify({ ok: problems.length === 0, packages: rows, problems, warnings }, null, 2));
} else {
  console.log("发布包内容审查：");
  for (const r of rows) {
    console.log(`  ✓ ${r.name}@${r.version}  ${String(r.files).padStart(4)} 个文件 / ${r.sizeMB} MB  (${r.dir})`);
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.log(
    problems.length === 0
      ? `\n✓ 通过（${rows.length} 个包，版本 ${[...versions].join(",")}）`
      : `\n✗ ${problems.length} 项问题`
  );
}

process.exit(problems.length === 0 ? 0 : 1);
