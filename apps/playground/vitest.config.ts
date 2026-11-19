import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // .vue SFC 组件测试（happy-dom 环境按文件注解启用）需要 vue 插件编译
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
