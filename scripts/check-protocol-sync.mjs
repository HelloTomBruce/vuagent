#!/usr/bin/env node
/**
 * 协议类型同步卡口（TASK-056 引入；TASK-061 升级为声明文本级对比）：
 * 对比 @vuagent/protocol（lifecycle.ts + events.ts）导出的契约类型与
 * @vuagent/ui vendored 副本（runtime/protocol-types.ts），不一致即失败。
 *
 * 背景：@vuagent/ui 以 npm 包分发时必须自包含（零 workspace 依赖），
 * 契约类型以内联副本随包分发，历史上靠人工同步——本脚本把同步变成 CI 卡口。
 *
 * 对比维度（三层）：
 * 1. 导出类型/接口名集合（两侧一致；守卫函数 export function 天然不在范围——
 *    抽取器只锚定 export type|interface，TASK-056 的豁免语义保持不变）
 * 2. AgentComponentStatus 字面量成员（四态生命周期漂移即失败，报错信息更友好）
 * 3. 【TASK-061】逐名声明文本对比：抽取每个导出 type/interface 的声明块，
 *    剥离注释、折叠空白后归一化比对——接口加/删字段、字段可选性变化、
 *    union 成员增删全部拦截（防护力从「名集合」提升到「文本同构」，
 *    events.ts FROZEN 头注释「类型漂移由卡口拦截」的宣言自此成立）
 *
 * 归一化语义：注释与空白不参与比对（两侧格式化差异不误报）；
 * 字段顺序参与比对（副本契约即「逐字同步」，顺序漂移同样应被察觉）。
 *
 * 已知边界（受控语料下成立）：声明块内不含含 `;`、`{`、`}` 的字符串字面量
 * 类型——语料即本仓两个源文件，若未来出现此类形状需同步扩展扫描器。
 *
 * 用法：node scripts/check-protocol-sync.mjs（或 pnpm protocol:sync-check）
 *       node scripts/check-protocol-sync.mjs --self-test（内嵌漂移 fixture 回归自测）
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

/** 剥离块注释与行注释（受控语料：类型声明内字符串字面量不含注释符号，直接剥离安全） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** 折叠全部空白为单个空格并修剪 */
function normalizeWhitespace(src) {
  return src.replace(/\s+/g, " ").trim();
}

/**
 * 按导出名抽取声明文本块：从 `export type|interface NAME` 起，
 * 深度 0 下遇到 `;` 即终止（接口/对象类型的嵌套括号、union 内联成员、
 * 泛型体内嵌对象均安全）；无尾随分号风格的声明（`}` 后直接接下一个
 * export）以「下一个顶层 export 关键字」为界；EOF 兜底。
 * 返回 Map<名称, 归一化声明文本>。
 */
function extractDeclarations(src) {
  const clean = stripComments(src);
  const map = new Map();
  const re = /export\s+(?:type|interface)\s+(\w+)/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const name = m[1];
    let depth = 0;
    let end = -1;
    for (let i = re.lastIndex; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ";" && depth === 0) {
        end = i;
        break;
      } else if (
        depth === 0 &&
        i > re.lastIndex &&
        /^export\s/.test(clean.slice(i, i + 7))
      ) {
        // 无尾随分号风格：下一个顶层声明开始，在其前截止
        end = i - 1;
        break;
      }
    }
    if (end === -1) end = clean.length - 1; // EOF 兜底
    map.set(name, normalizeWhitespace(clean.slice(m.index, end + 1)));
  }
  return map;
}

// ==========================================
// 自测（--self-test）：内嵌 fixture 回归，满足 TASK-061 验收
// 「人为制造字段级漂移脚本必须失败」且不污染真实文件
// ==========================================
const FIXTURE_ORIGINAL = `export type Probe = {
  /** doc comment */
  a: string;
  b?: number;
}; // tail comment
`;
const FIXTURE_DRIFTED_FIELD = FIXTURE_ORIGINAL.replace(
  "b?: number;",
  "b?: number;\n  c: boolean;"
);
const FIXTURE_DRIFTED_OPTIONALITY = FIXTURE_ORIGINAL.replace("b?: number;", "b: number;");
const FIXTURE_REFORMATTED = `export type Probe = { a: string; b?: number; };`;

function runSelfTest() {
  const cases = [];
  const expect = (label, actual, want) =>
    cases.push({ label, ok: actual === want });

  const base = extractDeclarations(FIXTURE_ORIGINAL);

  // ① 字段级漂移（加字段）必须被拦截
  expect("加字段漂移被拦截",
    extractDeclarations(FIXTURE_DRIFTED_FIELD).get("Probe") !== base.get("Probe"), true);
  // ② 可选性漂移（?: → :）必须被拦截
  expect("可选性漂移被拦截",
    extractDeclarations(FIXTURE_DRIFTED_OPTIONALITY).get("Probe") !== base.get("Probe"), true);
  // ③ 纯格式化差异不得误报
  expect("格式化差异不误报",
    extractDeclarations(FIXTURE_REFORMATTED).get("Probe") === base.get("Probe"), true);
  // ④ 注释差异不得误报（含块注释/行注释/声明前 JSDoc）
  expect("注释差异不误报",
    base.get("Probe") ===
      extractDeclarations(`/** 头注释 */ export type Probe = { a: string; b?: number; };`).get("Probe"), true);
  // ⑤ union 成员增删必须被拦截
  const unionBase = extractDeclarations(`export type U = { type: "a"; x: string } | { type: "b" };`);
  const unionDrift = extractDeclarations(`export type U = { type: "a"; x: string } | { type: "b" } | { type: "c" };`);
  expect("union 成员增删被拦截", unionDrift.get("U") !== unionBase.get("U"), true);
  // ⑥ 无尾随分号风格：相邻声明必须各自成块（不吞并下一个声明）
  const noSemi = extractDeclarations(
    `export interface A { x: string }\nexport type B = "p" | "q";`
  );
  expect("无尾随分号 interface 不吞并后续声明",
    noSemi.get("A") === "export interface A { x: string }", true);

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.label}`);
  }
  if (failed.length > 0) {
    console.error(`[protocol-sync] 自测失败：${failed.length}/${cases.length} 项不通过`);
    process.exit(1);
  }
  console.log(`[protocol-sync] 自测通过：${cases.length}/${cases.length} 项`);
}

// ==========================================
// 主流程
// ==========================================
const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
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

// 1. 名集合一致性（快速失败的第一层）
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

// 2. AgentComponentStatus 字面量成员（报错信息更友好的专项层）
const protocolStatus = statusLiterals(protocolFiles[0]);
const vendoredStatus = statusLiterals(vendoredFile);
if (protocolStatus !== vendoredStatus) {
  errors.push(
    `AgentComponentStatus 字面量漂移:\n` +
      `  protocol: ${protocolStatus}\n` +
      `  vendored: ${vendoredStatus}`
  );
}

// 3. 【TASK-061】逐名声明文本对比（字段级漂移拦截：加/删字段、可选性、union 成员）
const protocolDecls = new Map();
for (const f of protocolFiles) {
  for (const [name, decl] of extractDeclarations(readFileSync(f, "utf-8"))) {
    protocolDecls.set(name, decl);
  }
}
const vendoredDecls = extractDeclarations(readFileSync(vendoredFile, "utf-8"));
for (const [name, decl] of protocolDecls) {
  const vendored = vendoredDecls.get(name);
  if (vendored === undefined) continue; // 缺失已由名集合层报告，不重复计数
  if (vendored !== decl) {
    const clip = (s) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);
    errors.push(
      `契约类型 ${name} 声明文本漂移（字段级差异）:\n` +
        `  protocol: ${clip(decl)}\n` +
        `  vendored: ${clip(vendored)}\n` +
        `  → 请按 packages/protocol/src 侧原文同步 packages/ui/src/runtime/protocol-types.ts`
    );
  }
}

if (errors.length > 0) {
  console.error("[protocol-sync] 契约副本不同步：\n");
  for (const e of errors) console.error(`  ✗ ${e}\n`);
  process.exit(1);
}

console.log(
  `[protocol-sync] OK：${protocolNames.size} 个契约类型名 + ${protocolDecls.size} 个声明文本逐字比对一致（AgentComponentStatus=${protocolStatus}）`
);
