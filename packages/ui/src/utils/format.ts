/** 共享格式化工具（零依赖，SSR 安全） */

/** 1420 → "1.4s" · 830 → "830ms" · 65_000 → "1m 05s" · 3_600_000 → "1h 00m" */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** 980 → "980" · 12_400 → "12.4K" · 99_500 → "99.5K" · 1_240_000 → "1.2M" */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    const text = k < 100 ? k.toFixed(1).replace(/\.0$/, "") : String(Math.round(k));
    return `${text}K`;
  }
  const m = n / 1_000_000;
  return m < 100 ? m.toFixed(1).replace(/\.0$/, "") + "M" : `${Math.round(m)}M`;
}

/** 任意值 → 可展示文本：对象美化、JSON 字符串解析后美化、其余原样 */
export function toDisplayText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        return v;
      }
    }
    return v;
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}
