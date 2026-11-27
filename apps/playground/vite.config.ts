import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/** 从 monorepo 根 package.json 读取产品版本,注入给 src/brand.ts 的控制台横幅 */
const rootVersion: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version as string;

/**
 * 开发/演示壳（私有，不发布）：/console 直接消费 @vuagent/console-app，
 * 其余为 demo 页。生产产物在 apps/console（T16 结构抽取后不再有 --mode console）。
 */
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
  },
  optimizeDeps: {
    // workspace 源码库（TS/SFC 直出）需由 Vite 自行 transform
    exclude: ["@vuagent/ui", "@vuagent/console-app"],
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
      // 跟随 pnpm workspace symlink，让 packages/{ui,console} 的源码改动也能热更新
      followSymlinks: true,
    },
  },
});
