import { createApp } from "vue";
// 设计令牌与页面基础样式由 @vuagent/console-app 入口带出（与生产壳同一份，避免漂移）；
// 命名导入本身就会执行该模块，无需额外的 side-effect import。
import App from "./App.vue";
import { router } from "./router";
import { printConsoleBanner } from "./brand";
import { registerBuiltinCardComponents } from "@vuagent/console-app";

// 业务场景组件注册（Generative UI）与生产壳共用同一入口，保证行为一致
registerBuiltinCardComponents();

createApp(App).use(router).mount("#app");

printConsoleBanner();
