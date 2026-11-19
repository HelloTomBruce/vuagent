import { createApp } from "vue";
import "@vuagent/ui/tokens.css";
import "./app.css";
import App from "./App.vue";
import { router } from "./router";
import { printConsoleBanner } from "./brand";

createApp(App).use(router).mount("#app");

printConsoleBanner();
