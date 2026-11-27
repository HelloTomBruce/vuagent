import { createRouter, createWebHistory } from "vue-router";
import { demoRoutes } from "./routes-demo";

/**
 * playground 路由：
 * - 默认模式：/console + 全部 demo 页（顶部菜单切换）；
 * - --mode console（0.7.0 CLI 发布产物）：只保留 /console 与 / 重定向——demo 是内部
 *   开发资源，不进发布包。__CONSOLE_ONLY__ 由 vite define 替换为字面量 true，
 *   三元被静态折叠后 demoRoutes import 被 tree-shake，demo lazy chunk 不会产出。
 */
const baseRoutes = [
  { path: "/", redirect: "/console" },
  { path: "/console", name: "console", component: () => import("./Console.vue"), meta: { title: "Agent 控制台" } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: __CONSOLE_ONLY__ ? baseRoutes : [...baseRoutes, ...demoRoutes],
});
