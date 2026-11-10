/// <reference types="vitest/config" />
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ["src/**/*.ts", "src/**/*.vue"],
      outDir: "dist/types",
      cleanVueFileName: false,
      entryRoot: "src",
    }),
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "index",
      cssFileName: "vuagent-ui",
    },
    rollupOptions: {
      external: ["vue"],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
