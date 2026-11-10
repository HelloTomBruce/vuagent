/** 字节数人性化（B/KB/MB/GB），零依赖 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const text = Number.isInteger(v) || v >= 100 ? String(Math.round(v)) : v.toFixed(1);
  return `${text} ${units[i]}`;
}
