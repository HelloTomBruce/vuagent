/**
 * 词级 diff（零依赖，LCS）。
 * 分词规则：CJK 字符逐字成词、拉丁/数字连续串成词、其余单字符成词；
 * 每个词记录"前面是否有空格"，渲染时还原原文的空格节奏。
 * 中文没有词间空格，逐字分词保证中文文案也能做词级（字级）diff。
 */

export type DiffTokenType = "same" | "del" | "add";
export type DiffToken = { type: DiffTokenType; t: string; sp: boolean };

type Tok = { t: string; sp: boolean };

const TOKEN_RE =
  /([\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af])|([A-Za-z0-9][A-Za-z0-9'_-]*)|(\s+)|([\s\S])/g;

/** 把文本切成带空格标记的词序列 */
export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let pendingSp = false;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[3] !== undefined) {
      pendingSp = true;
      continue;
    }
    out.push({ t: m[0], sp: pendingSp && out.length > 0 });
    pendingSp = false;
  }
  return out;
}

/** 规模保护：token 数乘积超过此值时退化为"整段删 + 整段加" */
const MAX_DP_CELLS = 1_000_000;

/** LCS 词级 diff */
export function wordDiff(a: string, b: string): DiffToken[] {
  const at = tokenize(a);
  const bt = tokenize(b);
  const n = at.length;
  const m = bt.length;

  if (n * m > MAX_DP_CELLS) {
    const out: DiffToken[] = [];
    for (const tok of at) out.push({ type: "del", t: tok.t, sp: tok.sp });
    for (const tok of bt) out.push({ type: "add", t: tok.t, sp: tok.sp });
    return out;
  }

  // LCS 表：dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = at[i]!.t === bt[j]!.t ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at[i]!.t === bt[j]!.t) {
      out.push({ type: "same", t: at[i]!.t, sp: at[i]!.sp });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "del", t: at[i]!.t, sp: at[i]!.sp });
      i++;
    } else {
      out.push({ type: "add", t: bt[j]!.t, sp: bt[j]!.sp });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", t: at[i]!.t, sp: at[i]!.sp });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", t: bt[j]!.t, sp: bt[j]!.sp });
    j++;
  }
  return out;
}

/** 一个可整体接受/拒绝的"变更单元"：连续的 del/add 合并；same 为静态片段 */
export type DiffPiece = {
  /** 静态片段（same 文本）；变更单元无此字段 */
  same?: string;
  /** 原文侧文本（被删除的词） */
  del?: string;
  /** 新稿侧文本（新增的词） */
  add?: string;
};

/** diff 结果 → 渲染用的变更单元序列（空格节奏已还原） */
export function buildDiffUnits(a: string, b: string): DiffPiece[] {
  const units: DiffPiece[] = [];
  let buf: { del?: string; add?: string } = {};

  const hasContent = () => units.length > 0 || buf.del !== undefined || buf.add !== undefined;
  const flush = () => {
    if (buf.del !== undefined || buf.add !== undefined) units.push({ ...buf });
    buf = {};
  };

  for (const op of wordDiff(a, b)) {
    const lead = op.sp && hasContent() ? " " : "";
    if (op.type === "same") {
      flush();
      const last = units[units.length - 1];
      if (last && last.same !== undefined) last.same += lead + op.t;
      else units.push({ same: lead + op.t });
    } else {
      const key = op.type === "del" ? "del" : "add";
      buf[key] = buf[key] === undefined ? lead + op.t : (buf[key] + " " + op.t);
    }
  }
  flush();
  return units;
}

/** 按接受/拒绝结果合成最终文本；未决的变更整段剔除（含其遗留空格） */
export function diffResult(units: DiffPiece[], accepted: Record<number, boolean>): string {
  let out = "";
  let dropNextLead = false;
  units.forEach((u, i) => {
    if (u.same !== undefined) {
      const text = dropNextLead ? u.same.replace(/^\s+/, "") : u.same;
      dropNextLead = false;
      out += text;
      return;
    }
    const acc = accepted[i];
    if (acc === undefined) {
      dropNextLead = true;
      return;
    }
    out += acc ? (u.add ?? "") : (u.del ?? "");
  });
  return out
    .replace(/\s+/g, " ")
    .trim();
}
