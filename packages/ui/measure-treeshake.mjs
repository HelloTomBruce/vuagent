#!/usr/bin/env node
/**
 * tree-shaking 体积测量（TASK-013）：
 * 模拟真实消费路径 —— 先把 src/index.ts 打成发布形态的单文件 ES bundle（等价 dist/index.js），
 * 再构建一个仅 import { VaButton } 的"宿主入口"，测量二次构建（消费方 tree-shaking）后的产物体积，
 * 并检测 approval-card / trajectory 等无关组件代码是否被拉入。
 * 用法：node packages/ui/measure-treeshake.mjs
 */
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const tmp = path.join(here, ".treeshake-tmp");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

// ── 阶段 A：打出发布形态的单文件 lib bundle（含顶层副作用的原始状态） ──
await build({
  configFile: false,
  logLevel: "silent",
  plugins: [vue()],
  build: {
    outDir: tmp,
    minify: false, // 不压缩，模拟 dist/index.js 发布形态，让消费方自行 minify+shake
    lib: { entry: path.join(here, "src/index.ts"), formats: ["es"], fileName: "index" },
    rollupOptions: { external: ["vue"] },
  },
});
const libFile = path.join(tmp, "index.js");
const libSize = fs.statSync(libFile).size;
console.log(`发布包单文件 bundle（未压缩）: ${(libSize / 1024).toFixed(2)} KiB`);

// ── 阶段 B：宿主仅 import { VaButton }，做消费方 tree-shaking ──
const fixture = path.join(tmp, "fixture.mjs");
fs.writeFileSync(fixture, `import { VaButton } from "./index.js";\nconsole.log(VaButton);\n`);

const result = await build({
  configFile: false,
  logLevel: "silent",
  build: {
    write: false,
    minify: "esbuild",
    lib: { entry: fixture, formats: ["es"] },
    rollupOptions: { external: ["vue"] },
  },
});

const outputs = (Array.isArray(result) ? result.flatMap((r) => r.output) : result.output).filter(
  (c) => c.type === "chunk",
);
let totalJs = 0;
const markers = {
  "approval-card (va-acd)": "va-acd",
  "trajectory": "va-traj",
  "agent-plan": "va-plan",
  "metric-chart": "va-metric-chart",
  "VaAgentRenderer": "va-agent-renderer",
  "registry 默认注册(审批申请)": "审批申请",
};
const hits = {};
for (const chunk of outputs) {
  totalJs += chunk.code.length;
  for (const [label, needle] of Object.entries(markers)) {
    if (chunk.code.includes(needle)) hits[label] = true;
  }
}
console.log(`宿主仅 import VaButton 的产物（minify 后）: ${(totalJs / 1024).toFixed(2)} KiB`);
const leaked = Object.keys(hits);
if (leaked.length) {
  console.log(`✗ 被拉入的无关代码: ${leaked.join(", ")}`);
} else {
  console.log("✓ 未拉入 approval-card / trajectory / registry 等无关代码");
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exitCode = leaked.length ? 1 : 0;
