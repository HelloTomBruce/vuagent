/**
 * 行级 diff（零依赖 LCS）+ hunk 折叠分组 + 行内词级配对。
 * VaCodeDiff 的渲染数据源；也可独立用于服务端预计算。
 */

import { wordDiff } from "./wordDiff";

export type LineDiffType = "same" | "del" | "add";

/** 一行 diff：type=del 有 oldNo，type=add 有 newNo，same 两者都有 */
export interface LineDiffRow {
  type: LineDiffType;
  /** 旧文件 1-based 行号（same/del） */
  oldNo?: number;
  /** 新文件 1-based 行号（same/add） */
  newNo?: number;
  text: string;
}

/** 按换行切分；结尾换行符不产生多余空行，空文本为 0 行 */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "" && text.endsWith("\n")) lines.pop();
  return lines;
}

/** 规模保护：行数乘积超过此值退化为"整文件删 + 整文件加"（与 wordDiff 同策略） */
const MAX_DP_CELLS = 4_000_000;

/** LCS 行级 diff */
export function lineDiff(oldText: string, newText: string): LineDiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_DP_CELLS) {
    return [
      ...a.map((text, i) => ({ type: "del" as const, oldNo: i + 1, text })),
      ...b.map((text, j) => ({ type: "add" as const, newNo: j + 1, text })),
    ];
  }

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  const pushSame = () => rows.push({ type: "same", oldNo: i + 1, newNo: j + 1, text: a[i]! });
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushSame();
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ type: "del", oldNo: i + 1, text: a[i]! });
      i++;
    } else {
      rows.push({ type: "add", newNo: j + 1, text: b[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ type: "del", oldNo: i + 1, text: a[i]! }), i++;
  while (j < m) rows.push({ type: "add", newNo: j + 1, text: b[j]! }), j++;
  return rows;
}

/* -------------------------------------------------- */
/* 行内词级配对：连续 del 块与相邻 add 块逐行 zip 词级高亮 */
/* -------------------------------------------------- */

export interface InlineSegment {
  kind: "same" | "del" | "add";
  text: string;
}

/** 单行词级 diff → 交替片段流；无差异返回 null（行完全相同不该走到这） */
function toSegments(tokens: { type: string; t: string; sp: boolean }[]): InlineSegment[] {
  const segs: InlineSegment[] = [];
  for (const tok of tokens) {
    const lead = tok.sp && segs.length > 0 ? " " : "";
    const last = segs[segs.length - 1];
    if (last && last.kind === tok.type) last.text += lead + tok.t;
    else segs.push({ kind: tok.type as InlineSegment["kind"], text: lead + tok.t });
  }
  return segs;
}

/**
 * 配对相邻的 del/add 块，逐行词级高亮。
 * 返回与 rows 等长的数组：same 行与未配对行为 undefined；
 * 配对的第 k 对 del/add 行分别得到 del/add 侧片段。
 */
export function pairInline(
  rows: LineDiffRow[],
  enabled = true,
): ({ del: InlineSegment[]; add: InlineSegment[] } | undefined)[] {
  const out: ({ del: InlineSegment[]; add: InlineSegment[] } | undefined)[] = new Array(rows.length).fill(undefined);
  if (!enabled) return out;

  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.type !== "del") {
      i++;
      continue;
    }
    // 收集连续 del 块
    const delStart = i;
    while (i < rows.length && rows[i]!.type === "del") i++;
    const delEnd = i;
    // 紧随的连续 add 块
    const addStart = i;
    while (i < rows.length && rows[i]!.type === "add") i++;
    const addEnd = i;

    const pairs = Math.min(delEnd - delStart, addEnd - addStart);
    for (let k = 0; k < pairs; k++) {
      const oldLine = rows[delStart + k]!.text;
      const newLine = rows[addStart + k]!.text;
      if (oldLine === newLine) continue;
      // 词级：同一 token 序列里 del/add 混排，拆成两条侧视图
      const delSegs: InlineSegment[] = [];
      const addSegs: InlineSegment[] = [];
      for (const seg of toSegments(wordDiff(oldLine, newLine))) {
        if (seg.kind === "del" || seg.kind === "same") delSegs.push({ kind: seg.kind, text: seg.text });
        if (seg.kind === "add" || seg.kind === "same") addSegs.push({ kind: seg.kind, text: seg.text });
      }
      out[delStart + k] = { del: delSegs, add: addSegs };
    }
  }
  return out;
}

/* -------------------------------------------------- */
/* hunk 折叠：变更行 ± context 保留，其余 same 压成展开器 */
/* -------------------------------------------------- */

export type RenderRow =
  | { kind: "row"; row: LineDiffRow; inline?: { del: InlineSegment[]; add: InlineSegment[] } }
  | { kind: "expand"; count: number; from: number; to: number };

/** 段 key：折叠段唯一标识（旧文件行号范围） */
export function expandKey(e: { from: number; to: number }): string {
  return `${e.from}-${e.to}`;
}

/**
 * LCS 行序列 → 渲染行序列。
 * context：变更行前后保留的相同行数（git 默认 3）。
 * expanded：已展开的折叠段 key 集合（受控展示全部逻辑由组件管理）。
 */
export function groupHunks(
  rows: LineDiffRow[],
  context = 3,
  inline?: Array<{ del: InlineSegment[]; add: InlineSegment[] } | undefined>,
  expanded?: ReadonlySet<string>,
): RenderRow[] {
  const keep = new Uint8Array(rows.length);
  rows.forEach((r, i) => {
    if (r.type === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = 1;
  });

  const out: RenderRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      const row = rows[i]!;
      out.push(row.type === "same" ? { kind: "row", row } : { kind: "row", row, inline: inline?.[i] });
      i++;
      continue;
    }
    // 连续折叠段
    const start = i;
    while (i < rows.length && !keep[i]) i++;
    const from = rows[start]!.oldNo ?? rows[start]!.newNo ?? start + 1;
    const last = rows[i - 1]!;
    const to = last.oldNo ?? last.newNo ?? i;
    const key = expandKey({ from, to });
    if (expanded?.has(key)) {
      for (let k = start; k < i; k++) {
        const row = rows[k]!;
        out.push(row.type === "same" ? { kind: "row", row } : { kind: "row", row, inline: inline?.[k] });
      }
    } else {
      out.push({ kind: "expand", count: i - start, from, to });
    }
  }
  return out;
}
