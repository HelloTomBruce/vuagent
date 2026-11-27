/**
 * @vuagent/console-app —— Vuagent Console 应用源码库（T16 结构抽取）。
 *
 * 两个宿主共用同一份实现：
 * - `apps/console`（生产壳，发布为 `@vuagent/console` 静态包，CLI 内置托管）；
 * - `apps/playground`（开发/演示壳，含 /m1 /gallery 等 demo 路由）。
 *
 * 消费者两种接法：
 * - 组件：`<Console />`（由宿主自己的路由/布局承载）；
 * - 独立挂载：`mountConsole(el)`（生产壳用，自带组件注册与清理）。
 */
// 设计令牌与页面基础样式放在库入口：任何宿主（生产壳/开发壳/第三方）只要 import
// 本包就自动带上，避免「某个壳忘了引 tokens.css → 全部留白」这类漂移。
// （0.7.0 首发事故：生产壳只调 mountConsole，未引 tokens/shell → --va-* 全空、
//  body margin 8px、100% 高度链断裂。）
import "@vuagent/ui/tokens.css";
import "./styles/shell.css";
import { createApp, type App as VueApp } from "vue";
import { registerCardComponent } from "@vuagent/ui";
import ConsoleRoot from "./Console.vue";
import DeployStatusCard from "./console/custom-components/DeployStatusCard.vue";

export { default as Console } from "./Console.vue";
/** 主题状态（dev 壳的主题切换按钮与 ThemeDemo 复用；生产壳由 console 内部自用） */
export { useTheme } from "./console/composables/useTheme";
export type { ThemePreference } from "./console/composables/useTheme";

/**
 * 业务场景组件注册（Generative UI）：模型输出对应 component 时由 CardRenderer
 * 动态分发挂载。两个宿主都走这里，保证「开发看到什么 = 生产看到什么」。
 * 幂等：重复调用覆盖同名注册，无副作用。
 */
export function registerBuiltinCardComponents(): void {
  registerCardComponent("ui_deploy_status", DeployStatusCard);
}

export interface MountConsoleOptions {
  /** 挂载前是否注册内置业务卡片（默认 true） */
  registerBuiltins?: boolean;
}

/** 独立挂载 console（生产薄壳入口）；返回 Vue app 便于宿主卸载/扩展 */
export function mountConsole(el: string | Element, options: MountConsoleOptions = {}): VueApp {
  if (options.registerBuiltins !== false) registerBuiltinCardComponents();
  const app = createApp(ConsoleRoot);
  app.mount(el);
  return app;
}
