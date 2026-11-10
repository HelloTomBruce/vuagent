import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    watch: {
      // 跟随 pnpm workspace symlink，让 packages/ui 的源码改动也能热更新
      followSymlinks: true,
    },
  },
});
