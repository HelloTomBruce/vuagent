import { createRouter, createWebHistory } from "vue-router";

/** playground 路由：每个里程碑一个页面，顶部菜单切换 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/m7" },
    { path: "/m1", name: "m1", component: () => import("./M1Demo.vue"), meta: { title: "M1 打样" } },
    { path: "/run", name: "run", component: () => import("./AgentRunDemo.vue"), meta: { title: "旗舰编排" } },
    { path: "/m3", name: "m3", component: () => import("./M3Demo.vue"), meta: { title: "M3 Chat" } },
    { path: "/m5", name: "m5", component: () => import("./M5Demo.vue"), meta: { title: "M5 刚需批" } },
    { path: "/m6", name: "m6", component: () => import("./M6Demo.vue"), meta: { title: "M6 表单批" } },
    { path: "/m7", name: "m7", component: () => import("./M7Demo.vue"), meta: { title: "M7 收官批" } },
    { path: "/gallery", name: "gallery", component: () => import("./Gallery.vue"), meta: { title: "画廊" } },
  ],
});
