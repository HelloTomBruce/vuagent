#!/usr/bin/env node
/**
 * 生成 shadcn-vue registry JSON（packages/ui/registry/）。
 * 每个组件目录一条 item：SFC 内联 CSS（保持"单文件拷贝"体验）+ types.ts + useXxx.ts + context.ts/store.ts。
 * 用法：pnpm registry
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { components } from "../meta/components.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI_SRC = path.join(ROOT, "packages/ui/src/components");
const OUT_DIR = path.join(ROOT, "packages/ui/registry");

fs.mkdirSync(OUT_DIR, { recursive: true });

/** 内联 SFC 的 <style src="...">，使拷出的单文件自带样式；用到 .va-act 时自动附带按钮基类 */
const BUTTON_BASE = path.join(ROOT, "packages/ui/src/styles/button.css");

function inlineCss(sfcContent, dir) {
  let out = sfcContent.replace(
    /<style src="\.\/([^"]+?)\.css"><\/style>/g,
    (_, cssName) => `<style>\n${fs.readFileSync(path.join(dir, `${cssName}.css`), "utf8").trim()}\n</style>`,
  );
  // 组件模板使用了按钮基类 → 把基类追加进内联样式（源码中基类来自全局 button.css）
  if (/class="[^"]*\bva-act\b/.test(out)) {
    const base = fs.readFileSync(BUTTON_BASE, "utf8").trim();
    out = out.replace(/<style>\n([\s\S]*?)\n<\/style>/, (_, css) => `<style>\n${css}\n\n/* 按钮基类（自动附带） */\n${base}\n</style>`);
  }
  return out;
}

/** 目录内随组件携带的附加 ts 文件（types / composable / context / store） */
function extraFiles(dir) {
  return fs.readdirSync(dir).filter((f) => {
    if (!f.endsWith(".ts")) return false;
    if (f === "index.ts") return false; // 出口文件不随单文件拷贝分发
    return true;
  });
}

const items = [];
for (const c of components) {
  const dir = path.join(UI_SRC, c.dir);
  if (!fs.existsSync(dir)) {
    console.error(`✗ 目录不存在：${dir}`);
    process.exitCode = 1;
    continue;
  }

  const files = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".css")) continue; // 已内联
    if (f === "index.ts") continue;
    const full = path.join(dir, f);
    let content = fs.readFileSync(full, "utf8");
    if (f.endsWith(".vue")) content = inlineCss(content, dir);
    files.push({
      path: `components/ui/${c.slug}/${f}`,
      type: "registry:ui",
      target: `components/ui/${c.slug}/${f}`,
      content,
    });
  }

  const item = {
    $schema: "https://shadcn-vue.com/schema/registry-item.json",
    name: c.slug,
    title: c.title,
    description: c.desc,
    type: "registry:ui",
    dependencies: [],
    // 组件间依赖（如 StepperForm → ProgressTracker）：宿主 add 时自动拉取
    registryDependencies: (c.deps ?? []).map((d) => `@vuagent/${d}`),
    docs: c.props.map((p) => `- \`${p.name}\` (${p.type}${p.default ? `，默认 ${p.default}` : ""})：${p.desc}`).join("\n"),
    files,
  };

  fs.writeFileSync(path.join(OUT_DIR, `${c.slug}.json`), `${JSON.stringify(item, null, 2)}\n`);
  items.push({ name: c.slug, title: c.title, description: c.desc, type: "registry:ui" });
  console.log(`✓ registry/${c.slug}.json（${files.length} 个文件${c.deps?.length ? ` · 依赖 ${c.deps.join(", ")}` : ""}）`);
}

const index = {
  $schema: "https://shadcn-vue.com/schema/registry.json",
  name: "@vuagent",
  homepage: "https://hellotombruce.github.io/vuagent",
  items,
};
fs.writeFileSync(path.join(OUT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`\n${items.length} 条 item 写入 packages/ui/registry/（含 index.json）`);
console.log(`宿主使用：在 components.json 注册 {"@vuagent": "https://hellotombruce.github.io/vuagent/r/{name}.json"} 后 npx shadcn-vue add @vuagent/<name>`);
