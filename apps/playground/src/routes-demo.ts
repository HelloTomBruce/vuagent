/**
 * demo 页面路由（playground 内部开发/演示资源）。
 * 仅在非 console 模式下被 router.ts 引用——__CONSOLE_ONLY__ 为字面量 true 时，
 * 该 import 被 tree-shake，demo lazy chunk 不会进入 CLI 发布产物。
 */
export const demoRoutes = [
  { path: "/m1", name: "m1", component: () => import("./M1Demo.vue"), meta: { title: "M1 打样" } },
  { path: "/run", name: "run", component: () => import("./AgentRunDemo.vue"), meta: { title: "旗舰编排" } },
  { path: "/m3", name: "m3", component: () => import("./M3Demo.vue"), meta: { title: "M3 Chat" } },
  { path: "/m5", name: "m5", component: () => import("./M5Demo.vue"), meta: { title: "M5 刚需批" } },
  { path: "/m6", name: "m6", component: () => import("./M6Demo.vue"), meta: { title: "M6 表单批" } },
  { path: "/m7", name: "m7", component: () => import("./M7Demo.vue"), meta: { title: "M7 收官批" } },
  { path: "/overlay", name: "overlay", component: () => import("./OverlayDemo.vue"), meta: { title: "Overlay 浮层" } },
  { path: "/gallery", name: "gallery", component: () => import("./Gallery.vue"), meta: { title: "画廊" } },
  { path: "/theme", name: "theme", component: () => import("./ThemeDemo.vue"), meta: { title: "主题" } },
];
