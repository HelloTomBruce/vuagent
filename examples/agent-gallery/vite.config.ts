import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 6992,
    proxy: {
      "/api": {
        target: "http://localhost:6881",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ["@vuagent/ui"],
  },
});
