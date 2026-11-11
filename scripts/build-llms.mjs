#!/usr/bin/env node
/**
 * 生成 llms.txt 与 llms-full.txt（供 AI 编码工具一次性读取组件库能力）。
 * 数据源：meta/components.mjs。用法：pnpm llms
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { components } from "../meta/components.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 分类取 meta 声明顺序（保持与组件总览一致，新增分类自动纳入） */
const CATEGORIES = [...new Set(components.map((c) => c.category))];

const header = `# Vuagent

> Vue 生态第一个 Agent Ops 组件库：为 AI agent 产品的运行时操作界面（计划 / 审批 / 工具调用 / 上下文 / 收件箱）而生的 Vue 3 组件。
> 每个组件 = 薄模板 + 独立样式 + 强类型 + composable 逻辑；零运行时依赖（peer 仅 vue ^3.5），亮暗双主题（跟随 [data-theme="dark"] / .dark），全部动效尊重 prefers-reduced-motion。

## 安装与使用

- npm：\`npm i @vuagent/ui\`，从 \`@vuagent/ui\` 导入组件，并引入 \`@vuagent/ui/tokens.css\`
- shadcn-vue registry：注册 \`"@vuagent": "<registry 地址>/{name}.json"\` 后 \`npx shadcn-vue add @vuagent/<name>\`（文件落到 components/ui/<name>/）
- 基础约定：Props 枚举对齐 affectUI（size: sm/md/lg，status: running/success/error）；时间统一毫秒；事件名 camelCase
- 主题：覆盖 \`:root\` 上的 \`--va-*\` 设计令牌即可全库换肤；组件级覆盖用局部变量（如 --va-btn-ink）
- llms-full.txt：全部组件的 props 明细表
`;

let full = header;
let short = header;

for (const cat of CATEGORIES) {
  const list = components.filter((c) => c.category === cat);
  if (!list.length) continue;
  short += `\n## ${cat}\n\n`;
  full += `\n## ${cat}\n\n`;
  for (const c of list) {
    short += `- [${c.title}](https://hellotombruce.github.io/vuagent/components/${c.slug}): ${c.desc}（${c.components.join(" / ")}）\n`;
    full += `### ${c.title}\n\n${c.desc}\n\n组件：${c.components.join("、")}\n\n| Prop / 事件 | 类型 | 默认 | 说明 |\n|---|---|---|---|\n`;
    for (const p of c.props) {
      full += `| \`${p.name}\` | \`${p.type}\` | ${p.default} | ${p.desc} |\n`;
    }
    full += "\n";
  }
}

fs.writeFileSync(path.join(ROOT, "llms.txt"), short);
fs.writeFileSync(path.join(ROOT, "llms-full.txt"), full);
console.log(`✓ llms.txt（${short.length} 字符）`);
console.log(`✓ llms-full.txt（${full.length} 字符）`);
