import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/** 产品版本注入（控制台横幅等） */
const rootVersion: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version as string;

/**
 * 生产 console 构建（发布为 @vuagent/console 静态包，由 CLI 内置托管）：
 * 只含 console 本身——无 demo 路由、无 playground 头栏，产物即 CLI 的 console 资源。
 */
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
  },
  optimizeDeps: {
    // workspace 源码库（TS/SFC 直出）需由 Vite 自行 transform，不预打包
    exclude: ["@vuagent/ui", "@vuagent/console-app"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 6996,
    proxy: {
      "/api": { target: "http://localhost:6880", changeOrigin: true },
    },
    watch: { followSymlinks: true },
  },
});
