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
 * 【TASK-090】比对范围扩至 interaction.ts（UI ↔ LLM 交互契约）：
 * 其中 ActionMeta / UIActionEnvelope / UIActionKind / UIAction*Envelope
 * 在 protocol 侧是 Static<typeof Schema> / Extract<> / 索引访问等**计算类型**，
 * vendored 副本只能按 Schema 语义展开为字面声明——文本必然不同构，
 * 故文本比对跳过计算型声明（仅名集合层把关），形状保真由
 * protocol 侧 Schema 测试与 ui 侧信封快照测试双侧兜底。
 * 字面声明（UIInteractionLevel / UIComponentInteraction）仍逐字比对。
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

/**
 * 【TASK-092】函数级 vendored 比对：非导出 interface + 函数文本逐字同步
 * （deriveFormResultSchema 派生器——ui vendored 副本见
 * packages/ui/src/runtime/form-result-schema.ts 头注释）。
 * 从 `(export )?(interface|function|const) NAME` 起做花括号/方括号深度匹配截取声明块
 * 剥离注释、折叠空白后归一化比对。
 */
const FUNCTION_CORPUS = [
  {
    label: "deriveFormResultSchema（form 派生器）",
    protocolPath: "packages/protocol/src/form.ts",
    vendoredPath: "packages/ui/src/runtime/form-result-schema.ts",
    names: ["FormFieldSpec", "deriveFormResultSchema"],
  },
  {
    label: "FORM_FIELD_TYPES（六型字段类型集，评审 R5：派生器输入形状同步锁死）",
    protocolPath: "packages/protocol/src/form.ts",
    vendoredPath: "packages/ui/src/runtime/registry.ts",
    names: ["FORM_FIELD_TYPES"],
  },
  {
    label: "deriveOptionPickerResultSchema（L2 option_picker 派生器，0.9.0 W3）",
    protocolPath: "packages/protocol/src/l2-components.ts",
    vendoredPath: "packages/ui/src/runtime/l2-result-schema.ts",
    names: ["OptionSpec", "deriveOptionPickerResultSchema"],
  },
  {
    label: "deriveDataTableResultSchema（L2 data_table 派生器，0.9.0 W3）",
    protocolPath: "packages/protocol/src/l2-components.ts",
    vendoredPath: "packages/ui/src/runtime/l2-result-schema.ts",
    names: ["ColumnSpec", "deriveDataTableResultSchema"],
  },
  {
    label: "flattenWizardFields（L2 wizard 步字段摊平，0.9.0 W3）",
    protocolPath: "packages/protocol/src/l2-components.ts",
    vendoredPath: "packages/ui/src/runtime/l2-result-schema.ts",
    names: ["flattenWizardFields"],
  },
];

function extractNamedBlock(src, name) {
  const clean = stripComments(src);
  const re = new RegExp(`(?:export\\s+)?(?:interface|function|const)\\s+${name}\\b`);
  const m = re.exec(clean);
  if (!m) return null;
  let depth = 0;
  let end = -1;
  for (let i = m.index; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      // 花括号归零 = interface/function 声明体结束（无尾分号风格安全）；
      // 方括号归零继续（new Set([...]) 语句还有闭合括号与分号），由 `;` 终止
      if (ch === "}" && depth <= 0) {
        end = i;
        break;
      }
    } else if (ch === ";" && depth <= 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  return normalizeWhitespace(clean.slice(m.index, end + 1));
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

  // ⑦【TASK-092】函数级比对：函数体漂移被拦截
  const fnBase = `export function f(x: number): number {\n  return x + 1;\n}`;
  const fnDrift = fnBase.replace("x + 1", "x + 2");
  expect("函数体漂移被拦截", extractNamedBlock(fnDrift, "f") !== extractNamedBlock(fnBase, "f"), true);
  // ⑧ 函数注释/空白差异不误报
  const fnCommented = `/** doc */\nexport function f(x: number): number {\n  // comment\n  return x + 1;\n}`;
  expect("函数注释差异不误报",
    extractNamedBlock(fnCommented, "f") === extractNamedBlock(fnBase, "f"), true);
  // ⑨ 嵌套花括号（对象字面量）截取正确
  const fnNested = `export function g(o: Record<string, unknown>) {\n  return { a: { b: 1 } };\n}`;
  expect("嵌套花括号函数截取",
    extractNamedBlock(fnNested, "g") === "export function g(o: Record<string, unknown>) { return { a: { b: 1 } }; }",
    true);
  // ⑩【TASK-092】无花括号 const（new Set([...]) 语句）：`;` 终止 + 成员漂移拦截
  const setBase = `export const S = new Set([\n  "a",\n  "b",\n]);\nexport const T = 1;`;
  expect("Set 常量截取正确",
    extractNamedBlock(setBase, "S") === "export const S = new Set([ \"a\", \"b\", ]);", true);
  expect("Set 常量成员漂移被拦截",
    extractNamedBlock(setBase.replace('"b",', '"b", "c",'), "S") !== extractNamedBlock(setBase, "S"), true);
  expect("Set 常量不吞并后续声明",
    extractNamedBlock(setBase, "S") !== extractNamedBlock(setBase, "S") + " export const T = 1;", true);

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
  // TASK-090：UI ↔ LLM 交互契约（信封 + 组件交互能力声明）
  join(root, "packages/protocol/src/interaction.ts"),
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
// 【TASK-090】计算型声明（Static<typeof …> / Extract<…> / typeof / 索引访问）
// 无法与 vendored 字面展开做文本同构比对——跳过文本层，仅名集合层把关。
const COMPUTED_DECL_RE = /\b(?:Static|Extract)\s*<|\btypeof\b|\[\s*"/;
const isComputedDeclaration = (decl) => COMPUTED_DECL_RE.test(decl);

const protocolDecls = new Map();
for (const f of protocolFiles) {
  for (const [name, decl] of extractDeclarations(readFileSync(f, "utf-8"))) {
    protocolDecls.set(name, decl);
  }
}
const vendoredDecls = extractDeclarations(readFileSync(vendoredFile, "utf-8"));
const nameOnlyCompared = [];
for (const [name, decl] of protocolDecls) {
  const vendored = vendoredDecls.get(name);
  if (vendored === undefined) continue; // 缺失已由名集合层报告，不重复计数
  if (isComputedDeclaration(decl)) {
    nameOnlyCompared.push(name);
    continue;
  }
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

// 4.【TASK-092】函数级 vendored 比对（FUNCTION_CORPUS）：派生器逐字同步
let functionBlocksCompared = 0;
for (const corpus of FUNCTION_CORPUS) {
  const protocolSrc = readFileSync(join(root, corpus.protocolPath), "utf-8");
  const vendoredSrc = readFileSync(join(root, corpus.vendoredPath), "utf-8");
  for (const name of corpus.names) {
    const fromProtocol = extractNamedBlock(protocolSrc, name);
    const fromVendored = extractNamedBlock(vendoredSrc, name);
    if (fromProtocol === null || fromVendored === null) {
      errors.push(
        `函数级比对语料缺失「${name}」:\n` +
          `  protocol(${corpus.protocolPath}): ${fromProtocol === null ? "未找到" : "已找到"}\n` +
          `  vendored(${corpus.vendoredPath}): ${fromVendored === null ? "未找到" : "已找到"}`
      );
      continue;
    }
    functionBlocksCompared++;
    if (fromProtocol !== fromVendored) {
      const clip = (s) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);
      errors.push(
        `vendored 副本「${name}」与 protocol 原文文本漂移（${corpus.label}）:\n` +
          `  protocol: ${clip(fromProtocol)}\n` +
          `  vendored: ${clip(fromVendored)}\n` +
          `  → 请按 packages/protocol 侧原文逐字同步 ${corpus.vendoredPath}（该文件刻意只承载语料内的声明）`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("[protocol-sync] 契约副本不同步：\n");
  for (const e of errors) console.error(`  ✗ ${e}\n`);
  process.exit(1);
}

const textCompared = protocolDecls.size - nameOnlyCompared.length;
console.log(
  `[protocol-sync] OK：${protocolNames.size} 个契约类型名一致；` +
    `${textCompared} 个字面声明逐字比对一致` +
    (nameOnlyCompared.length > 0
      ? `；${nameOnlyCompared.length} 个计算型声明仅名集合比对（${nameOnlyCompared.join(", ")}）`
      : "") +
    `；${functionBlocksCompared} 个函数级语料逐字比对一致` +
    `（AgentComponentStatus=${protocolStatus}）`
);
