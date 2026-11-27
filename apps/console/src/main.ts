import { mountConsole } from "@vuagent/console-app";

// 生产薄壳（T16）：只负责把 console 挂到 #app——组件注册、样式、主题全在库里，
// 与开发壳 apps/playground 共用同一份实现（"开发看到什么 = 生产看到什么"）。
mountConsole("#app");
