import { createRouter, createWebHistory } from "vue-router";
import { Console } from "@vuagent/console-app";
import { demoRoutes } from "./routes-demo";

/**
 * playground 路由（开发/演示壳，不发布）：
 * - /console → 直接消费 @vuagent/console-app 的 Console 组件（与生产壳同一份实现）；
 * - 其余为 demo 页（顶部菜单切换）。生产产物在 apps/console（T16 结构抽取后）。
 */
const baseRoutes = [
  { path: "/", redirect: "/console" },
  { path: "/console", name: "console", component: Console, meta: { title: "Agent 控制台" } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [...baseRoutes, ...demoRoutes],
});
