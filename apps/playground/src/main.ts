import { createApp } from "vue";
import "@vuagent/ui/tokens.css";
import "./app.css";
import App from "./App.vue";
import { router } from "./router";
import { printConsoleBanner } from "./brand";
import { registerCardComponent } from "@vuagent/ui";
import DeployStatusCard from "./console/custom-components/DeployStatusCard.vue";

// 注册业务场景组件（Generative UI：大模型输出对应 component 时由 CardRenderer 动态分发挂载）
registerCardComponent("ui_deploy_status", DeployStatusCard);

createApp(App).use(router).mount("#app");

printConsoleBanner();
