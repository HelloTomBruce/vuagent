/**
 * DevTools 控制台品牌横幅(playground 专属,库产物不包含此文件)。
 *
 * 「V 轨迹」mark:虚线计划 → 橙色审批环 → 实线执行 → 完成端点,
 * 以 badge 形态(纸底圆角瓷砖)的 data-URI 贴图打印,
 * 暗色 DevTools 下纸底仍保持可读。文字信息用 %c 样式,
 * 颜色取自 @vuagent/ui 的 --va-* 设计令牌(控制台读不到 CSS 变量,此处硬编码)。
 */

const ACCENT = "#c2410c";
const MUTED = "#6f6d66";
const DOCS = "https://hellotombruce.github.io/vuagent";

/** 版本号由 vite.config.ts define 注入(vitest 等无 define 环境回落) */
const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="21" fill="#F7F6F2"/><g transform="translate(5.76 5.94) scale(0.88)" fill="none" stroke-linecap="round"><path d="M25 20 L43.35 61.48" stroke="#1A1917" stroke-width="6.5" stroke-dasharray="6.5 12.5"/><path d="M52.65 61.48 L71 20" stroke="#C2410C" stroke-width="6.5"/><circle cx="48" cy="72" r="9.5" stroke="#C2410C" stroke-width="6"/><circle cx="71" cy="20" r="5.5" fill="#C2410C" stroke="none"/></g></svg>`;

export function printConsoleBanner(): void {
  // mark 贴图:%c 空串 + font-size 定尺寸,Chrome / Edge / Firefox 可显示
  console.log(
    "%c ",
    `font-size:88px;line-height:96px;background:url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(MARK_SVG)}") no-repeat center/contain;`,
  );
  console.log(
    `%c vuagent %c v${APP_VERSION} · Agent Ops UI for Vue 3`,
    `background:${ACCENT};color:#faf9f6;padding:2px 8px;border-radius:3px 0 0 3px;font-weight:700;`,
    `color:${MUTED};padding:2px 6px;`,
  );
  console.log(
    `%c计划 → 审批 → 执行:43+ 强类型组件,为 AI agent 的运行时操作界面而生`,
    `color:${MUTED};`,
  );
  console.log(`%c${DOCS}`, "color:#2563eb;text-decoration:underline;");
}
