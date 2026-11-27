import { createApp } from "vue";
import "@vuagent/ui/tokens.css";
import "@vuagent/console-app/styles/shell.css";
import "./app.css";
import App from "./App.vue";
import { router } from "./router";
import { printConsoleBanner } from "./brand";
import { registerBuiltinCardComponents } from "@vuagent/console-app";

// 业务场景组件注册（Generative UI）与生产壳共用同一入口，保证行为一致
registerBuiltinCardComponents();

createApp(App).use(router).mount("#app");

printConsoleBanner();
