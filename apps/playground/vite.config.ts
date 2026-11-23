import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/** 从 monorepo 根 package.json 读取产品版本,注入给 src/brand.ts 的控制台横幅 */
const rootVersion: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version as string;

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
  },
  optimizeDeps: {
    exclude: ["@vuagent/ui"],
  },
  server: {
    port: 6995,
    proxy: {
      "/api": {
        target: "http://localhost:6880",
        changeOrigin: true,
      },
    },
    watch: {
      // 跟随 pnpm workspace symlink，让 packages/ui 的源码改动也能热更新
      followSymlinks: true,
    },
  },
});
