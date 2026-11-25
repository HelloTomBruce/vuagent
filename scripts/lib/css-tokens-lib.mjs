/**
 * CSS 令牌校验共享库（纯函数，无副作用）
 *
 * 被 scripts/check-tokens.mjs（CLI 门禁）与 packages/ui/tests/*.test.ts（单测）共同消费。
 * 所有函数只做解析/比较，不碰文件系统，便于边界用例单测（TASK-006 评审 N5）。
 */

/** 剥离 /* *\/ 块注释，同时维护 stripped→raw 下标映射（用于错误定位原始行号） */
export function stripComments(css) {
  let out = "";
  /** strippedIdx -> rawIdx 映射（稀疏数组，只记录映射变更点也行，这里直接全量映射简单可靠） */
  const map = new Array(css.length);
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      // 注释内容整体折叠为一个空格（保留词法分隔），映射点指向注释起始
      out += " ";
      map[out.length - 1] = i;
      i = stop;
    } else {
      out += css[i];
      map[out.length - 1] = i;
      i++;
    }
  }
  return { text: out, map };
}

/** stripped 下标 → 原始 css 行号（1 起） */
export function lineAtRaw(css, map, strippedIdx) {
  const rawIdx = map[strippedIdx] ?? css.length - 1;
  let line = 1;
  for (let i = 0; i < rawIdx && i < css.length; i++) {
    if (css[i] === "\n") line++;
  }
  return line;
}

/** 归一化字面值用于比较（含 #abc→#aabbcc 等价展开、前导零补齐、负号前缀 -.5） */
export function normalize(value) {
  return value
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, "#$1$1$2$2$3$3")
    .replace(/(^|[(:,-])\.(\d)/g, "$10.$2");
}

/** 解析 tokens.css 的顶层 block（该文件无嵌套），返回 [选择器, 声明体] 列表 */
export function parseBlocks(css) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const stripped = stripComments(css).text;
  while ((m = re.exec(stripped))) blocks.push([m[1].trim(), m[2]]);
  return blocks;
}

/** 从 tokens.css 提取亮色（:root）与暗色两组令牌值 */
export function parseTokens(css) {
  const light = {};
  const dark = {};
  for (const [selector, body] of parseBlocks(css)) {
    const target = /dark/i.test(selector) ? dark : light;
    for (const decl of body.split(";")) {
      const m = decl.match(/(--[\w-]+)\s*:\s*([^\s;][^;]*)/);
      if (m) target[m[1]] = m[2].trim();
    }
  }
  return { light, dark };
}

/** 通用配对符扫描：从 startIdx 的 open 起找匹配的 close 下标；未配对返回 -1 */
export function matchDelim(text, startIdx, open, close) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 找到字符串中与 startIdx 处 '(' 匹配的 ')' 下标；未配对返回 -1 */
export function matchParen(text, startIdx) {
  return matchDelim(text, startIdx, "(", ")");
}

/** 内层字符串第一个顶层逗号下标（无则 -1） */
export function topCommaIndex(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * 提取全部 var(--va-*) 引用（含嵌套链的内外层）。
 * 返回 { refs: [{ name, fallback, offset }], unmatched: [offset] }。
 * offset 基于**传入文本**（调用方决定传原始还是剥注释后的文本）。
 */
export function extractVarRefs(css) {
  const refs = [];
  const unmatched = [];
  let idx = css.indexOf("var(");
  while (idx !== -1) {
    const openIdx = idx + 3;
    const closeIdx = matchParen(css, openIdx);
    if (closeIdx === -1) {
      // 未配对括号（注释残句/生成中代码）：跳过这一个，不中断后续扫描
      unmatched.push(idx);
      idx = css.indexOf("var(", idx + 4);
      continue;
    }
    const inner = css.slice(openIdx + 1, closeIdx);
    const commaIdx = topCommaIndex(inner);
    const name = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
    const fallback = commaIdx === -1 ? null : inner.slice(commaIdx + 1).trim();
    refs.push({ name, fallback, offset: idx });
    idx = css.indexOf("var(", idx + 4);
  }
  return { refs, unmatched };
}

/**
 * L2 语义令牌判定（TASK-002 引入的语义档位族）。
 * 这些令牌在单文件拷贝分发场景必须有字面 fallback——裸引用会导致
 * 无 tokens.css 宿主 IACVT 整条声明失效（TASK-006 评审 C1）。
 */
const L2_PATTERNS = [
  /^--va-fs-/, // 字号 scale
  /^--va-lh-/, // 行高
  /^--va-fw-/, // 字重
  /^--va-tracking-/, // 字距
  /^--va-h-/, // 控件高度
  /^--va-icon-/, // 图标尺寸
  /^--va-z-/, // z-index 阶梯
  /^--va-dur-/, // 动效时长
  /^--va-dist-/, // 动效位移
  /^--va-ease/, // 缓动曲线（含裸 --va-ease）
  /^--va-skel-/, // 骨架屏
  /^--va-s3h$/, // 间距半步
  /^--va-s4h$/,
  /^--va-scrim$/, // 遮罩
  /-contrast$/, // 语义对照色
];

export function isL2Token(name) {
  return L2_PATTERNS.some((re) => re.test(name));
}

/**
 * 找出 L2 令牌的裸引用（无 fallback）。
 * 在剥注释后的文本上扫描（避免注释示例误报），offset 经 map 映射回原始行号。
 */
export function findBareL2Refs(css) {
  const { text, map } = stripComments(css);
  const { refs } = extractVarRefs(text);
  return refs
    .filter((r) => r.fallback === null && isL2Token(r.name))
    .map((r) => ({ name: r.name, offset: r.offset, line: lineAtRaw(css, map, r.offset) }));
}

/**
 * 找出「全局令牌裸引用」：引用了 tokens 集合中定义的令牌且无 fallback。
 * 这是分发自包含的完整口径——凡 tokens.css 定义的令牌，拷出到无 tokens 宿主
 * 都需要字面 fallback（L3 组件钩子不在 tokens 集合内，天然跳过）。
 */
export function findBareTokenRefs(css, tokens) {
  const { text, map } = stripComments(css);
  const { refs } = extractVarRefs(text);
  return refs
    .filter((r) => r.fallback === null && r.name.startsWith("--va-") && r.name in tokens)
    .map((r) => ({ name: r.name, offset: r.offset, line: lineAtRaw(css, map, r.offset) }));
}

/** 从 .vue 单文件组件提取 <style> 块，返回 [{ css, startLine }]（startLine 为块在原文件中的 1 起行号；不含 <style src=...> 外链形式） */
export function extractStyleBlocks(vueSource) {
  const blocks = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(vueSource))) {
    const startLine = vueSource.slice(0, m.index).split("\n").length;
    blocks.push({ css: m[1], startLine });
  }
  return blocks;
}

/** 提取全部 @keyframes 定义，返回 { name: 规范化 body }（同文件同名取后值；花括号配对解析） */
export function extractKeyframes(css) {
  const { text } = stripComments(css);
  const out = {};
  let idx = text.indexOf("@keyframes");
  while (idx !== -1) {
    const head = /^@keyframes\s+([\w-]+)\s*\{/.exec(text.slice(idx));
    if (!head) {
      idx = text.indexOf("@keyframes", idx + 10);
      continue;
    }
    const openIdx = idx + head[0].length - 1;
    const closeIdx = matchDelim(text, openIdx, "{", "}");
    if (closeIdx !== -1) {
      out[head[1]] = normalize(text.slice(openIdx + 1, closeIdx));
      idx = text.indexOf("@keyframes", closeIdx);
    } else {
      idx = text.indexOf("@keyframes", idx + 10);
    }
  }
  return out;
}

/**
 * 插画装饰循环白名单（时长字面量豁免）：表演节奏独立于 UI 脉冲底速
 * （--va-dur-loop），不随宿主动效档位迁移——这类 keyframes 的 animation
 * 简写中允许裸 <time> 字面量。新增装饰插画在此登记，其余一律走令牌。
 */
export const DECORATIVE_ANIMATIONS = new Set([
  "va-orb-ripple",
  "va-orb-breathe",
  "va-orb-eq", // VoiceOrb 插画三态
  "va-team-float", // AgentTeam 环形悬浮
  "va-wheel-spin", // ModelWheel 慢自转
  "va-gf-breathe",
  "va-gt-flow", // 渐变地面/文字流光
  "va-grid-drift", // 网格底纹漂移（周期由 composable 注入 CSS 变量，天然令牌化）
  "va-gradient-border-spin", // 渐变边框光环
]);

/** 抠掉 var(...) 整段（含嵌套括号，长度保持不变）：fallback 字面量是分发口径的合法存在 */
function blankVarSegments(text) {
  let out = text;
  let idx = out.indexOf("var(");
  while (idx !== -1) {
    const openIdx = idx + 3;
    const closeIdx = matchParen(out, openIdx);
    if (closeIdx === -1) break; // 未配对：交由引用扫描的 unmatched 警告，这里停止
    out = out.slice(0, idx) + " ".repeat(closeIdx - idx + 1) + out.slice(closeIdx + 1);
    idx = out.indexOf("var(", idx + 4);
  }
  return out;
}

/**
 * 时长字面量扫描（动效档位纪律）：transition/animation 简写与 *-duration 长手里，
 * 裸 <time> 字面量（如 120ms / 0.7s）会绕过动效档位——档位迁移与宿主调速静默失效，
 * 必须经 --va-* 令牌（var 或 calc 派生）给出。
 * 豁免：0s/0ms（visibility 翻转等零时长语义）、var() 内 fallback、插画白名单首词、
 * delay 长手（transition-delay/animation-delay 属编排细节，不入档位）。
 * 返回 [{ prop, value, literal, offset }]（offset 基于传入文本，调用方映射行号）。
 */
export function findBareTimeLiterals(css) {
  const { text } = stripComments(css);
  const hits = [];
  const declRe = /(^|[;{])\s*((?:transition|animation)(?:-duration)?)\s*:\s*([^;}]*)/g;
  let m;
  while ((m = declRe.exec(text))) {
    const [, , prop, rawValue] = m;
    // animation 简写：首个标识符为 keyframes 名，命中插画白名单整条豁免
    if (prop === "animation") {
      const nameMatch = /^\s*([\w-]+)/.exec(rawValue);
      if (nameMatch && DECORATIVE_ANIMATIONS.has(nameMatch[1])) continue;
    }
    const blanked = blankVarSegments(rawValue);
    const litRe = /(?<![\w./-])(\d*\.?\d+)(ms|s)(?![\w-])/g;
    let lm;
    while ((lm = litRe.exec(blanked))) {
      // 零时长语义：0s/0ms（visibility 延迟翻转）与亚毫秒（0.01ms !important 秒杀块）
      if (Number(lm[1]) === 0 || (lm[2] === "ms" && Number(lm[1]) < 1)) continue;
      hits.push({ prop, value: rawValue.trim(), literal: lm[0], offset: m.index });
      break; // 每条声明报一处即可
    }
  }
  return hits;
}
