/**
 * registry 自包含规则（build-registry 与 check-registry 共用，TASK-009）。
 *
 * 单文件拷贝哲学下的解析不变量 —— 条目内任何相对 import 必须可解析：
 *   1. `./types` 等同目录引用        → 必须随条目 files 携带
 *   2. `../<slug>/...` 组件间引用    → 必须声明在 registryDependencies
 *   3. `../../composables|utils` 共享模块 → 一律由生成器内联，不允许残留
 */

/** 具名 import 语句（含 import type、跨行大括号）——仅匹配相对路径说明符 */
export const NAMED_IMPORT_RE = /import\s+(type\s+)?\{[^}]*\}\s*from\s*["'](\.[^"']+)["'];?/g;

/** 具名 import 语句 —— 任意说明符（相对 + 外部模块，如 vue） */
export const NAMED_IMPORT_ANY_RE = /import\s+(type\s+)?\{[^}]*\}\s*from\s*["']([^"']+)["'];?/g;

/** 文件内容中的全部相对 import 说明符（named + side-effect import） */
export function collectRelativeSpecs(content) {
  const specs = new Set();
  for (const m of content.matchAll(NAMED_IMPORT_RE)) specs.add(m[2]);
  for (const m of content.matchAll(/(?:^|[;\s])import\s*["'](\.[^"']+)["']/g)) specs.add(m[1]);
  return [...specs];
}

/** POSIX 语义的 dir + 相对说明符 拼接归一（不依赖平台 path） */
function normalizeJoin(dir, spec) {
  const parts = [];
  for (const seg of `${dir}/${spec}`.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * 校验单条 registry item 的自包含性，返回问题数组（空数组 = 通过）。
 * item 需含 files[{path,target,content}] 与 registryDependencies[]。
 * globalTargets（可选）：全部条目 target 的并集，用于校验组件间引用的文件确实随依赖条目分发。
 */
export function checkItemSelfContainment(item, globalTargets) {
  const carried = new Set(item.files.map((f) => f.target));
  const registryDeps = item.registryDependencies ?? [];
  const problems = [];
  for (const f of item.files) {
    const dirOf = f.target.split("/").slice(0, -1).join("/");
    for (const spec of collectRelativeSpecs(f.content)) {
      const resolved = normalizeJoin(dirOf, spec);
      // 1. 条目自身携带（./types.ts、../progress-tracker → index.ts 等候选）
      if (carried.has(resolved) || carried.has(`${resolved}.ts`) || carried.has(`${resolved}/index.ts`)) continue;
      // 2. 组件间依赖：../<slug>(/file)? 且已声明 registryDependencies
      const cross = resolved.match(/^components\/ui\/([a-z0-9-]+)(?:\/|$)/);
      if (cross && cross[1] !== item.name && registryDeps.includes(`@vuagent/${cross[1]}`)) {
        // 全局校验可用时，确认引用的文件确实随依赖条目携带
        if (globalTargets && !(
          globalTargets.has(resolved) || globalTargets.has(`${resolved}.ts`) || globalTargets.has(`${resolved}/index.ts`)
        )) {
          problems.push(`${f.path} → "${spec}"（依赖条目 ${cross[1]} 未携带该文件）`);
        }
        continue;
      }
      problems.push(`${f.path} → "${spec}"`);
    }
  }
  return problems;
}
