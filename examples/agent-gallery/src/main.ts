import { createApp } from "vue";
import "@vuagent/ui/tokens.css";
import "./styles/app.css";
import App from "./App.vue";
import { registerCardComponent } from "@vuagent/ui";

import ClusterHealthCard from "./scenes/cloudops/ClusterHealthCard.vue";
import CanaryDeployCard from "./scenes/cloudops/CanaryDeployCard.vue";
import AnalysisPlanCard from "./scenes/analysis/AnalysisPlanCard.vue";
import AnalysisReportCard from "./scenes/analysis/AnalysisReportCard.vue";
import CodeChangeCard from "./scenes/code/CodeChangeCard.vue";
import CodeCheckpointCard from "./scenes/code/CodeCheckpointCard.vue";
import CopyPolishCard from "./scenes/copy/CopyPolishCard.vue";
import TaskInboxCard from "./scenes/tasks/TaskInboxCard.vue";
import TaskLogCard from "./scenes/tasks/TaskLogCard.vue";

// 注册全部场景的 Generative UI 卡片：模型调用工具返回组件标识时，由消息流动态挂载
registerCardComponent("ui_cluster_health", ClusterHealthCard);
registerCardComponent("ui_canary_deploy", CanaryDeployCard);
registerCardComponent("ui_analysis_plan", AnalysisPlanCard);
registerCardComponent("ui_analysis_report", AnalysisReportCard);
registerCardComponent("ui_code_change", CodeChangeCard);
registerCardComponent("ui_code_checkpoint", CodeCheckpointCard);
registerCardComponent("ui_copy_polish", CopyPolishCard);
registerCardComponent("ui_task_inbox", TaskInboxCard);
registerCardComponent("ui_task_log", TaskLogCard);

createApp(App).mount("#app");
