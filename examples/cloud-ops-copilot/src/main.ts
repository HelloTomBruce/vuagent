import { createApp } from "vue";
import "@vuagent/ui/tokens.css";
import "./styles/app.css";
import App from "./App.vue";
import { registerCardComponent } from "@vuagent/ui";
import ClusterHealthCard from "./cards/ClusterHealthCard.vue";
import CanaryDeployCard from "./cards/CanaryDeployCard.vue";

// 注册业务自定义 Generative UI 场景卡片
// 当大模型调用对应工具返回组件标识时，由 vuagent 消息流动态挂载
registerCardComponent("ui_cluster_health", ClusterHealthCard);
registerCardComponent("ui_canary_deploy", CanaryDeployCard);

createApp(App).mount("#app");
