#!/usr/bin/env node
/**
 * 生成 shadcn-vue registry JSON（packages/ui/registry/）。
 * 每个组件目录一条 item：SFC 内联 CSS（保持"单文件拷贝"体验）+ types.ts + useXxx.ts + context.ts/store.ts。
 * 用法：pnpm registry
 *
 * 自包含分发（TASK-009）：
 *   - 共享 composables/utils：内联进使用它的文件（去 export、递归解析依赖闭包、命名冲突守卫）
 *   - 组件间依赖（../<slug>/）：自动检测并与 meta deps 合并写入 registryDependencies
 *   - 构建期自包含断言：任何未携带且未声明的相对引用直接构建失败（scripts/registry-rules.mjs）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { components } from "../meta/components.mjs";
import { checkItemSelfContainment, NAMED_IMPORT_RE, NAMED_IMPORT_ANY_RE } from "./registry-rules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI_SRC = path.join(ROOT, "packages/ui/src");
const COMPONENTS_SRC = path.join(UI_SRC, "components");
const OUT_DIR = path.join(ROOT, "packages/ui/registry");

fs.mkdirSync(OUT_DIR, { recursive: true });

/** 内联 SFC 的 <style src="...">，使拷出的单文件自带样式；用到 .va-act 时自动附带按钮基类，
 *  用到 motion.css 动效工具类（va-enter、va-exit、va-crossfade、va-fade-in、va-copy、va-spotlight、va-shake 家族）时
 *  自动附带共享动效基建（否则拷出后进出场/复制反馈/微振静默失效） */
const BUTTON_BASE = path.join(ROOT, "packages/ui/src/styles/button.css");
const MOTION_BASE = path.join(ROOT, "packages/ui/src/styles/motion.css");
const MOTION_UTILITY_RE = /\b(va-enter-[\w-]+|va-exit-[\w-]+|va-crossfade|va-fade-in|va-copy[\w-]*|va-spotlight|va-shake)\b/;

function inlineCss(sfcContent, dir) {
  let out = sfcContent.replace(
    /<style src="\.\/([^"]+?)\.css"><\/style>/g,
    (_, cssName) => `<style>\n${fs.readFileSync(path.join(dir, `${cssName}.css`), "utf8").trim()}\n</style>`,
  );
  // 组件模板使用了按钮基类 → 把基类追加进内联样式（源码中基类来自全局 button.css）
  if (/class="[^"]*\bva-act\b/.test(out)) {
    const base = fs.readFileSync(BUTTON_BASE, "utf8").trim();
    out = out.replace(/<style>\n([\s\S]*?)\n<\/style>/, (_, css) => `<style>\n${css}\n\n/* 按钮基类（自动附带） */\n${base}\n</style>`);
  }
  // 组件使用了动效工具类 → 追加 motion.css（同 button 基类口径；全文件附带保持单一来源）
  if (MOTION_UTILITY_RE.test(out)) {
    const motion = fs.readFileSync(MOTION_BASE, "utf8").trim();
    out = out.replace(/<style>\n([\s\S]*?)\n<\/style>/, (_, css) => `<style>\n${css}\n\n/* 动效工具类（自动附带，源码中来自全局 motion.css） */\n${motion}\n</style>`);
  }
  return out;
}

/** 目录内随组件携带的附加 ts 文件（types / composable / context / store） */
function extraFiles(dir) {
  return fs.readdirSync(dir).filter((f) => {
    if (!f.endsWith(".ts")) return false;
    if (f === "index.ts") return false; // 出口文件不随单文件拷贝分发
    return true;
  });
}

/** 从组件源码 import 自动检测外部 npm 依赖（排除 vue / 相对路径 / @vuagent 内部包），写入 dependencies */
function externalDeps(files) {
  const pkgs = new Set();
  for (const f of files) {
    const src = String(f.content);
    for (const m of src.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".") || spec === "vue" || spec.startsWith("vue/") || spec.startsWith("@vuagent/")) continue;
      pkgs.add(spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"));
    }
  }
  return [...pkgs];
}

/* ==========================================================================
   共享 composables/utils 内联（TASK-009）
   ========================================================================== */

/** POSIX 语义的 dir + 相对说明符 拼接归一 */
function normalizeRel(dir, spec) {
  const parts = [];
  for (const seg of `${dir}/${spec}`.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** 去掉声明式 export 前缀：内联进宿主文件后不暴露共享模块的公共面 */
function stripExports(src) {
  return src.replace(/^export\s+(?=(?:async\s+)?(?:function|const|type|interface|class)\b)/gm, "");
}

/**
 * 加载共享模块及其相对依赖闭包（DFS 后序：依赖在先）。
 * 返回 [{ rel, src }]；闭包内部的相对 import 行会被剥离（符号由闭包内相邻块提供），
 * vue 等外部 import 原样保留。
 */
function loadSharedClosure(rel, visited = new Set(), order = []) {
  if (visited.has(rel)) return order;
  visited.add(rel);
  const full = path.join(UI_SRC, `${rel}.ts`);
  if (!fs.existsSync(full)) throw new Error(`[registry] 共享模块不存在：src/${rel}.ts`);
  const src = fs.readFileSync(full, "utf8");
  const internalDeps = [];
  for (const m of src.matchAll(NAMED_IMPORT_RE)) {
    const spec = m[2];
    if (spec.startsWith("./") || spec.startsWith("../")) {
      internalDeps.push(normalizeRel(path.posix.dirname(rel), spec));
    }
  }
  for (const dep of internalDeps) loadSharedClosure(dep, visited, order);
  // 剥离闭包内部相对 import（依赖已在闭包中就地提供），保留 vue 等外部 import
  const stripped = src.replace(NAMED_IMPORT_RE, (m, _typeKw, spec) => (spec.startsWith(".") ? "" : m));
  order.push({ rel, src: stripped });
  return order;
}

const DECL_RE = /\b(?:function|const|let|var|type|interface|class)\s+([A-Za-z0-9_$]+)/g;
const SHARED_SPEC_RE = /^(\.\.\/\.\.\/)(composables|utils)\/([A-Za-z0-9_-]+)$/;

/** 拆出 import 语句花括号内的成员原始串（保留 "type X" 前缀） */
function importMembers(stmt) {
  return stmt.replace(/^import\s+(?:type\s+)?\{/, "").replace(/\}\s*from\s*["'][^"']+["'];?$/, "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * 把文件内容中的共享 composables/utils import 替换为内联代码。
 * 仅处理 ../../composables|utils 说明符；其余相对引用（组件间依赖）原样保留，
 * 由 registryDependencies 声明。无共享依赖时原样返回。
 *
 * 内联规约（TASK-009）：
 *   - chunk 间外部 import（vue 等）与消费文件既有 import 合并，统一前置，防重复声明
 *   - chunk 模块私有声明加确定性后缀 __vaN，防多 chunk 撞名（如 wordDiff/lineDiff 各自的 MAX_DP_CELLS）
 *   - chunk 的导出名保持原名（消费文件与跨 chunk 引用它们）；重名即构建失败
 */
function inlineSharedModules(content, label) {
  if (!content.includes("../../")) return content;
  const closures = new Map(); // rel -> [{rel, src}]
  let out = content.replace(NAMED_IMPORT_RE, (m, _typeKw, spec) => {
    const mm = spec.match(SHARED_SPEC_RE);
    if (!mm) return m;
    const rel = `${mm[2]}/${mm[3]}`;
    if (!closures.has(rel)) closures.set(rel, loadSharedClosure(rel));
    return ""; // 移除原 import 行，符号由内联块提供
  });
  if (closures.size === 0) return content;

  // 命名冲突守卫：共享导出名不得与消费文件既有声明撞名
  const sharedNames = new Set();
  for (const closure of closures.values()) {
    for (const { src } of closure) {
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|type|interface|class)\s+([A-Za-z0-9_$]+)/gm)) {
        sharedNames.add(m[1]);
      }
    }
  }
  for (const m of out.matchAll(DECL_RE)) {
    if (sharedNames.has(m[1])) {
      throw new Error(`[registry] ${label}：内联共享模块导出名 "${m[1]}" 与消费文件既有声明冲突，请改名后重试`);
    }
  }

  // 合并消费文件与全部 chunk 的外部 import → 统一前置（消费文件成员在前，chunk 新增成员在后）
  const importsByModule = new Map(); // module -> members[]（保序去重）
  for (const m of out.matchAll(NAMED_IMPORT_ANY_RE)) {
    if (m[2].startsWith(".")) continue;
    const list = importsByModule.get(m[2]) ?? [];
    for (const mem of importMembers(m[0])) if (!list.includes(mem)) list.push(mem);
    importsByModule.set(m[2], list);
  }
  const chunks = [];
  let chunkSeq = 0;
  for (const closure of closures.values()) {
    for (const { rel, src } of closure) {
      chunkSeq += 1;
      // 顶层声明分类：导出名保持原名，私有名加后缀 __vaN
      const exported = new Set();
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|type|interface|class)\s+([A-Za-z0-9_$]+)/gm)) {
        exported.add(m[1]);
      }
      const topLevel = new Set();
      for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|type|interface|class)\s+([A-Za-z0-9_$]+)/gm)) {
        topLevel.add(m[1]);
      }
      let body = stripExports(src);
      for (const name of topLevel) {
        if (exported.has(name)) continue;
        body = body.replace(new RegExp(`\\b${name}\\b`, "g"), `${name}__va${chunkSeq}`);
      }
      // chunk 自身的外部 import 剥离并并入合并清单
      body = body.replace(NAMED_IMPORT_ANY_RE, (m, _typeKw, spec) => {
        if (spec.startsWith(".")) return ""; // 闭包内相对引用已剥离，防御性兜底
        const list = importsByModule.get(spec) ?? [];
        for (const mem of importMembers(m)) if (!list.includes(mem)) list.push(mem);
        importsByModule.set(spec, list);
        return "";
      });
      chunks.push(`/* ── 内联自 @vuagent/ui src/${rel}.ts（registry 单文件拷贝自包含） ── */\n${body.trim()}`);
    }
  }
  // 移除消费文件既有的外部 import 行（已并入合并清单），其余内容原样
  out = out.replace(NAMED_IMPORT_ANY_RE, (m, _typeKw, spec) => (spec.startsWith(".") ? m : ""));
  const importLines = [...importsByModule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([mod, members]) => `import { ${members.join(", ")} } from "${mod}";`)
    .join("\n");
  return `${importLines}\n\n${out.trim()}\n\n${chunks.join("\n\n")}\n`;
}

/** .vue 文件只内联 <script> 块（不能把 TS 代码追加到 template/style 之后） */
function inlineSharedIntoFile(fileName, content) {
  if (fileName.endsWith(".vue")) {
    return content.replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/, (_m, open, body, close) => open + inlineSharedModules(body, fileName) + close);
  }
  return inlineSharedModules(content, fileName);
}

/* ==========================================================================
   组件间依赖自动检测（../<slug>/... → registryDependencies）
   ========================================================================== */

function detectCrossComponentDeps(files, selfName) {
  const slugs = new Set();
  for (const f of files) {
    for (const m of f.content.matchAll(NAMED_IMPORT_RE)) {
      const mm = m[2].match(/^\.\.\/([a-z0-9-]+)\//);
      if (mm && mm[1] !== selfName) slugs.add(mm[1]);
    }
  }
  return [...slugs];
}

const items = [];
for (const c of components) {
  const dir = path.join(COMPONENTS_SRC, c.dir);
  if (!fs.existsSync(dir)) {
    console.error(`✗ 目录不存在：${dir}`);
    process.exitCode = 1;
    continue;
  }

  const files = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".css")) continue; // 已内联
    // index.ts 随条目携带：组件可能被其他组件以裸 barrel（../progress-tracker）引用，
    // 不携带会导致宿主拷贝断链（TASK-009）
    const full = path.join(dir, f);
    let content = fs.readFileSync(full, "utf8");
    content = inlineSharedIntoFile(f, content); // 共享 composables/utils 内联（TASK-009）
    if (f.endsWith(".vue")) content = inlineCss(content, dir);
    files.push({
      path: `components/ui/${c.slug}/${f}`,
      type: "registry:ui",
      target: `components/ui/${c.slug}/${f}`,
      content,
    });
  }

  // registryDependencies = meta 声明 ∪ 自动检测的组件间 import
  const detected = detectCrossComponentDeps(files, c.slug);
  const declared = c.deps ?? [];
  const missingInMeta = detected.filter((d) => !declared.includes(d));
  if (missingInMeta.length) {
    console.warn(`⚠ ${c.slug}：检测到 meta deps 未声明的组件间依赖 ${missingInMeta.join(", ")}（已自动写入 registryDependencies，建议同步 meta/components.mjs）`);
  }
  const registryDependencies = [...new Set([...declared, ...detected])].map((d) => `@vuagent/${d}`);

  const item = {
    $schema: "https://shadcn-vue.com/schema/registry-item.json",
    name: c.slug,
    title: c.title,
    description: c.desc,
    type: "registry:ui",
    dependencies: externalDeps(files),
    // 组件间依赖（如 StepperForm → ProgressTracker）：宿主 add 时自动拉取
    registryDependencies,
    docs: c.props.map((p) => `- \`${p.name}\` (${p.type}${p.default ? `，默认 ${p.default}` : ""})：${p.desc}`).join("\n"),
    files,
  };

  // 构建期自包含断言：任何未携带且未声明的相对引用直接构建失败
  const problems = checkItemSelfContainment(item);
  if (problems.length) {
    console.error(`✗ ${c.slug}.json 自包含校验失败：\n` + problems.map((p) => `    ${p}`).join("\n"));
    process.exit(1);
  }

  fs.writeFileSync(path.join(OUT_DIR, `${c.slug}.json`), `${JSON.stringify(item, null, 2)}\n`);
  items.push({ name: c.slug, title: c.title, description: c.desc, type: "registry:ui" });
  const depNote = [...item.dependencies, ...item.registryDependencies];
  console.log(`✓ registry/${c.slug}.json（${files.length} 个文件${depNote.length ? ` · 依赖 ${depNote.join(", ")}` : ""}）`);
}

const index = {
  $schema: "https://shadcn-vue.com/schema/registry.json",
  name: "@vuagent",
  homepage: "https://hellotombruce.github.io/vuagent",
  items,
};
fs.writeFileSync(path.join(OUT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`\n${items.length} 条 item 写入 packages/ui/registry/（含 index.json）`);
console.log(`宿主使用：在 components.json 注册 {"@vuagent": "https://hellotombruce.github.io/vuagent/r/{name}.json"} 后 npx shadcn-vue add @vuagent/<name>`);
