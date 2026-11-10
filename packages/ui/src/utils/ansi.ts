/**
 * ANSI 转义解析（零依赖）。
 * 覆盖终端输出的常用子集：SGR 颜色/样式（含 256 色与真彩色）、
 * 其余 CSI/OSC 序列安全剥除、\r 行内重写（进度条场景）取最终帧。
 */

export interface AnsiSpan {
  text: string;
  /** 前景色 CSS 值；未设置时继承 */
  color?: string;
  /** 背景色 CSS 值 */
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** ANSI 基础 + 亮色色板（xterm 惯例，暗底终端可读） */
const PALETTE: string[] = [
  "#4f5b66", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
  "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
];

/** xterm 256 色：0-15 色板、16-231 6×6×6 立方、232-255 灰阶 */
function color256(n: number): string {
  if (n < 16) return PALETTE[n]!;
  if (n < 232) {
    const v = n - 16;
    const step = [0, 95, 135, 175, 215, 255];
    const r = step[Math.floor(v / 36) % 6]!;
    const g = step[Math.floor(v / 6) % 6]!;
    const b = step[v % 6]!;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

/** CSI 参数串（含分号/冒号） */
const CSI_RE = /\x1b\[([0-9;:]*)([A-Za-z])/g;
/** OSC（窗口标题等）…BEL 或 ST 结尾 */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

interface SgrState {
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** 应用一段 SGR 参数到状态 */
function applySgr(state: SgrState, codes: number[]) {
  let i = 0;
  while (i < codes.length) {
    const c = codes[i]!;
    if (c === 0) {
      state.color = state.bgColor = undefined;
      state.bold = state.dim = state.italic = state.underline = undefined;
    } else if (c === 1) state.bold = true;
    else if (c === 2) state.dim = true;
    else if (c === 3) state.italic = true;
    else if (c === 4) state.underline = true;
    else if (c === 22) state.bold = state.dim = undefined;
    else if (c === 23) state.italic = undefined;
    else if (c === 24) state.underline = undefined;
    else if (c >= 30 && c <= 37) state.color = PALETTE[c - 30]!;
    else if (c === 38 || c === 48) {
      // 38/48;5;n 与 38/48;2;r;g;b
      const mode = codes[i + 1];
      const target = c === 38 ? "color" : "bgColor";
      if (mode === 5 && codes[i + 2] !== undefined) {
        state[target] = color256(codes[i + 2]!);
        i += 2;
      } else if (mode === 2 && codes[i + 4] !== undefined) {
        state[target] = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      }
    } else if (c === 39) state.color = undefined;
    else if (c === 49) state.bgColor = undefined;
    else if (c >= 90 && c <= 97) state.color = PALETTE[c - 90 + 8]!;
    else if (c >= 100 && c <= 107) state.bgColor = PALETTE[c - 100 + 8]!;
    i++;
  }
}

/** 把一段纯文本 + 当前状态落成一个 span（无样式信息时省略字段） */
function pushSpan(out: AnsiSpan[], text: string, st: SgrState) {
  const hasStyle = st.color || st.bgColor || st.bold || st.dim || st.italic || st.underline;
  out.push(hasStyle ? { text, ...st } : { text });
}

/**
 * 解析单行（不含换行）为 span 序列。
 * - \r 重写：取 \r 分段的最后一个非空段（进度条最终帧）
 * - 非 SGR 的 CSI（光标移动等）与 OSC 剥除
 * - 空样式相邻 span 不合并由调用方处理（渲染开销可忽略）
 */
export function parseAnsiLine(line: string): AnsiSpan[] {
  const crParts = line.split("\r");
  let text = crParts[crParts.length - 1] ?? "";
  text = text.replace(OSC_RE, "");

  const out: AnsiSpan[] = [];
  const state: SgrState = {};
  let plain = "";
  let idx = 0;

  CSI_RE.lastIndex = 0;
  for (const m of text.matchAll(CSI_RE)) {
    if (m.index > idx) plain += text.slice(idx, m.index);
    idx = m.index + m[0].length;
    if (m[2] !== "m") continue; // 只处理 SGR，其余 CSI 剥除
    if (plain) {
      pushSpan(out, plain, state);
      plain = "";
    }
    const params = (m[1] ?? "").split(";").map((s) => (s === "" ? 0 : Number.parseInt(s, 10)));
    applySgr(state, params.length ? params : [0]);
  }
  if (idx < text.length) plain += text.slice(idx);
  if (plain) pushSpan(out, plain, state);
  return out;
}

/** 整段输出（可能多行）→ 行数组；每行独立解析 */
export function parseAnsi(text: string): AnsiSpan[][] {
  return text.replace(/\r\n?/g, "\n").split("\n").map(parseAnsiLine);
}
