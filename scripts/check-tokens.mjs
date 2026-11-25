#!/usr/bin/env node
/**
 * CSS 令牌一致性门禁（CLI）。解析/比较纯函数在 scripts/lib/css-tokens-lib.mjs，
 * 本文件只做文件遍历、检查编排与退出码。
 *
 * 背景：组件采用 shadcn 式「单文件拷贝」分发，组件 CSS 内联的 fallback 是
 * 拷出后无 tokens.css 时的实际渲染值。它与 tokens.css 漂移时，同一令牌在
 * 「库内」与「拷出/宿主未加载令牌」两种环境下颜色分叉。本脚本在构建期锁死。
 *
 * 检查项：
 * 1. fallback 漂移：var(--va-*, fallback) 的字面 fallback 归一化后须等于该令牌
 *    在 :root（亮色）或暗色块的值（允许暗色值，覆盖 Toaster 等恒暗表面）；
 * 2. 全局令牌裸引用：packages/ui/src 下凡引用 tokens.css 定义的 --va-* 令牌（含 L1
 *    色彩/间距/圆角/阴影/字体与 L2 语义档位族）禁止裸 var() 引用——无 tokens.css
 *    宿主会 IACVT 整条声明失效（TASK-006 评审 C1 及后续债务清偿）。
 *    组件文件内自定义的 L3 钩子（--va-<组件>-*）不在 tokens 集合内，自含引用合法；
 *    覆盖范围含 playground（宿主与库同标准，杜绝双轨）;
 * 3. @keyframes 同名一致性：同名 keyframes 在多文件定义时（单文件拷贝要求
 *    各文件自含）规范化 body 必须一致，防止一处改动静默影响全部 spinner；
 * 4. 时长字面量（动效档位纪律）：transition/animation 的 <time> 必须经 --va-*
 *    令牌（var/calc 派生）给出——裸写字面量绕过动效档位，档位迁移与宿主调速
 *    静默失效。豁免：0s/0ms、var() fallback、插画装饰循环白名单、delay 长手；
 * 5. fail-closed 守卫：tokens.css 解析为空、或实际校验数为 0 时按失败退出，
 *    守卫自身失效不得绿灯。
 *
 * 扫描范围：packages/ui/src 与 apps/playground/src 的 .css 与 .vue <style> 块
 * （JS 字符串中的 var() 引用不在扫描范围，见 TASK-006 评审记录）。
 * 用法：pnpm tokens:check（registry:check 亦会执行本检查）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTokens,
  stripComments,
  extractVarRefs,
  findBareTokenRefs,
  findBareTimeLiterals,
  extractStyleBlocks,
  extractKeyframes,
  normalize,
} from "./lib/css-tokens-lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKENS_PATH = path.join(ROOT, "packages/ui/src/styles/tokens.css");
const SCAN_DIRS = [
  path.join(ROOT, "packages/ui/src"),
  path.join(ROOT, "apps/playground/src"),
];
/** 递归收集指定扩展名文件 */
function listFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** 扫描单元：{ file, css, lineOffset }。.vue 取 <style> 块（逐块一个单元，行号回映射原文件） */
function collectUnits(dir) {
  const units = [];
  for (const file of listFiles(dir, [".css", ".vue"])) {
    const source = fs.readFileSync(file, "utf8");
    if (file.endsWith(".css")) {
      units.push({ file, css: source, lineOffset: 0 });
    } else {
      for (const block of extractStyleBlocks(source)) {
        units.push({ file, css: block.css, lineOffset: block.startLine - 1 });
      }
    }
  }
  return units;
}

function main() {
  const tokensCss = fs.readFileSync(TOKENS_PATH, "utf8");
  const { light, dark } = parseTokens(tokensCss);
  const problems = [];
  const warnings = [];
  const bareProblems = [];
  const timeProblems = [];
  let checked = 0;

  // fail-closed：tokens.css 解析为空（路径改错/结构重排）必须红灯
  if (Object.keys(light).length === 0) {
    console.error(`✗ tokens.css 未解析出任何 --va-* 令牌（${path.relative(ROOT, TOKENS_PATH)}），拒绝静默通过`);
    process.exit(1);
  }

  const keyframesIndex = new Map(); // name -> [{ file, body }]

  for (const dir of SCAN_DIRS) {
    for (const unit of collectUnits(dir)) {
      const rel = path.relative(ROOT, unit.file);
      const stripped = stripComments(unit.css);
      const { refs, unmatched } = extractVarRefs(stripped.text);

      for (const offset of unmatched) {
        const line = unit.lineOffset + stripped.text.slice(0, offset).split("\n").length;
        warnings.push(`${rel}:${line}  var( 括号未配对，该引用已跳过校验`);
      }

      for (const ref of refs) {
        if (!ref.name.startsWith("--va-")) continue;
        if (ref.fallback === null) continue; // 裸引用：漂移检查不适用（L2 家族由裸引用门禁接管）
        if (ref.fallback.includes("var(")) continue; // 钩子链，由内层扫描覆盖
        if (!(ref.name in light)) continue; // 亮色未定义的令牌跳过

        checked++;
        const fb = normalize(ref.fallback);
        const okLight = fb === normalize(light[ref.name]);
        const okDark = ref.name in dark && fb === normalize(dark[ref.name]);
        if (!okLight && !okDark) {
          const line = unit.lineOffset + stripped.text.slice(0, ref.offset).split("\n").length;
          problems.push(
            `${rel}:${line}  ${ref.name} fallback=${ref.fallback}  ` +
              `期望亮=${light[ref.name]}${ref.name in dark ? ` 或暗=${dark[ref.name]}` : ""}`
          );
        }
      }

      // 全局令牌裸引用门禁（库分发面 + playground 宿主同标准）：凡 tokens.css 定义的令牌禁止裸引用
      for (const bare of findBareTokenRefs(unit.css, light)) {
        bareProblems.push(
          `${rel}:${bare.line}  ${bare.name} 裸 var() 引用缺字面 fallback，` +
            `请补 tokens.css 亮色值（单文件拷贝分发要求）`
        );
      }

      // 时长字面量门禁（动效档位纪律）：transition/animation 的 <time> 须经令牌给出
      for (const hit of findBareTimeLiterals(unit.css)) {
        const line = unit.lineOffset + stripped.text.slice(0, hit.offset).split("\n").length;
        timeProblems.push(
          `${rel}:${line}  ${hit.prop}: ${hit.value}  裸时长 ${hit.literal}——` +
            `须经 --va-* 令牌（var/calc 派生）给出`
        );
      }

      for (const [name, body] of Object.entries(extractKeyframes(unit.css))) {
        if (!keyframesIndex.has(name)) keyframesIndex.set(name, []);
        keyframesIndex.get(name).push({ file: rel, body });
      }
    }
  }

  // 同名 keyframes 跨文件一致性（单文件拷贝分发下 spinner 等动画逐文件自含）
  for (const [name, defs] of keyframesIndex) {
    const files = defs.map((d) => d.file);
    const distinct = [...new Set(defs.map((d) => d.body))];
    if (defs.length > 1 && distinct.length > 1) {
      problems.push(
        `@keyframes ${name} 在 ${defs.length} 个文件同名定义但内容不一致（同名全局覆盖，` +
          `一处改动会静默影响全部）：\n    ${files.map((f) => f).join("\n    ")}`
      );
    }
  }

  // fail-closed：一条引用都没校验到（扫描根配错/扩展名遗漏）不得绿灯
  if (checked === 0) {
    console.error("✗ 未校验到任何 var(--va-*, fallback) 引用，扫描配置异常，拒绝静默通过");
    process.exit(1);
  }

  if (warnings.length) {
    console.warn(`⚠ ${warnings.length} 处可疑引用（不阻断）：`);
    for (const w of warnings) console.warn("  " + w);
  }

  if (bareProblems.length) {
    console.error(`✗ 全局令牌裸引用（${bareProblems.length} 处，缺字面 fallback）：`);
    for (const p of bareProblems) console.error("  " + p);
  }

  if (timeProblems.length) {
    console.error(`✗ 动效时长字面量（${timeProblems.length} 处，绕过动效档位）：`);
    for (const p of timeProblems) console.error("  " + p);
  }

  if (problems.length) {
    console.error(`✗ tokens fallback / keyframes 校验失败（${problems.length} 处 / 已校验 ${checked} 处）：`);
    for (const p of problems) console.error("  " + p);
  }

  if (problems.length || bareProblems.length || timeProblems.length) process.exit(1);
  console.log(
    `✓ tokens 校验通过：${checked} 处 fallback 一致、全局令牌裸引用 0 处、` +
      `动效时长字面量 0 处、${[...keyframesIndex.keys()].length} 个 @keyframes 同名一致性通过`
  );
}

main();
