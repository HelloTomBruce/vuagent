import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", name: "chat", component: () => import("./pages/ChatPage.vue"), meta: { title: "对话" } },
    { path: "/tasks", name: "tasks", component: () => import("./pages/TasksPage.vue"), meta: { title: "任务" } },
    { path: "/insights", name: "insights", component: () => import("./pages/InsightsPage.vue"), meta: { title: "洞察" } },
    { path: "/settings", name: "settings", component: () => import("./pages/SettingsPage.vue"), meta: { title: "设置" } },
  ],
});
