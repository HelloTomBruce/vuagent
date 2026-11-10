# Vuagent · 设计与架构文档 v0.1

> Vue 生态第一个 **Agent Ops 组件库**：agent 运行时操作界面（计划 / 审批 / 工具流 / 上下文 / 收件箱）的精致组件。
> 代号 **Vuagent**（vue + agent，正式名待定）；类名前缀 `va-`，CSS 变量前缀 `--va-`。

---

## 0. 决策记录（已确认）

| 决策项 | 结论 |
|---|---|
| 视觉风格 | **A 暖静 Calm**：暖白纸感底 + 墨色 + 柔和卡片 + 克制的单强调色（陶土橘），动效"安静而精确" |
| 默认色彩模式 | **跟随系统**（`prefers-color-scheme` 决定首次呈现，用户可手动切换，由宿主应用控制） |
| 授权 | **全 MIT 开源**；后期可追加商业增值层（Pro blocks/模板），代码层不设墙 |
| 差异化定位 | 不做"Vue 版 affectUI"；卡位 **Agent-Ops for Vue**（chat 组件只是配套，不是主角） |
| 组件形态 | 每组件一个目录（薄模板 .vue + 样式 .css + 类型 types.ts + 逻辑 useXxx.ts），npm 打包 + registry 单文件内联双形态 |
| 库间对齐 | props 枚举与 affectUI 对齐（`size: sm/md/lg`、`status: running/success/error`），降低用户迁移成本 |

## 1. 市场依据（2026-11 调研）

- React 侧 Agent-Ops 组件正爆发（assistant-ui Elements、agents-kit、Liro、reui），**品类需求已被验证**
- Vue 侧只有聊天级玩家（Element-Plus-X、Ant Design X Vue），**运行时操作界面完全空白**
- affectUI（React，$249 买断）103→173 项快速增长，证明"agent-ready UI"独立定位成立

## 2. 工程架构

### 2.1 Monorepo（pnpm workspaces）

```
vuagent/
├── packages/
│   └── ui/                      # 组件库本体（npm 发布物 @vuagent/ui）
│       ├── src/
│       │   ├── components/      # 每组件一个目录：index.ts + types.ts + useXxx.ts + VaXxx.vue + VaXxx.css
│       │   ├── composables/     # 跨组件共享逻辑（useNow / useCountdown …）
│       │   ├── utils/           # format / wordDiff（零依赖算法）
│       │   ├── styles/tokens.css# 设计令牌（:root 亮色 + dark 覆盖）
│       │   └── index.ts
│       ├── tests/               # vitest（逻辑型组件与算法必测）
│       ├── registry/            # (M3) 脚本生成的 shadcn-vue registry JSON
│       └── vite.config.ts       # lib mode（ESM）+ tokens 提取 + vitest
├── apps/
│   ├── docs/                    # (M3) VitePress 文档站 + llms.txt 自动生成
│   └── playground/              # showcase 应用（未来 agent 客户端的雏形）
├── scripts/                     # (M2/M3) registry / llms.txt / 新组件脚手架
└── pnpm-workspace.yaml
```

### 2.2 技术基线

| 项 | 决策 |
|---|---|
| 框架 | Vue 3.5+，`<script setup lang="ts">`，TS strict |
| 运行时依赖 | **0**（diff 算法、动效、图标全部内联实现；peer dep 仅 `vue`） |
| 构建 | Vite lib mode（ESM），`cssFileName: "vuagent-ui"` 提取 tokens |
| SSR/Nuxt 安全 | 模块顶层禁碰 `window/document`；`IntersectionObserver`/`matchMedia` 全部 guard |
| 无障碍 | 每组件完整键盘操作 + aria（对齐 affectUI 标准） |
| 动效可关 | 每组件尊重 `prefers-reduced-motion: reduce`（静止降级） |
| 版本/CI | (M3) changesets + GitHub Actions |
| 测试 | (M2) vitest：逻辑型组件必测（InlineDiff 算法、审批倒计时等） |

### 2.3 分发三通道

1. **npm**：`import { VaToolCallCard } from "@vuagent/ui"`
2. **shadcn-vue registry**（M3）：`npx shadcn-vue add @vuagent/tool-call-card` → 单 `.vue` 拷进项目
3. **AI 原生**（M3）：`llms.txt` / `llms-full.txt`；v0.2 MCP server

## 3. 样式与主题体系

### 3.1 组件组织规范（每个组件一个目录，四件套）

```
components/tool-call/
├── index.ts               # 出口：组件 + 类型（对库内与 registry 生成器统一）
├── types.ts               # 强类型：Props / Events / 公共枚举（可含常量标签）
├── useToolCallCard.ts     # 组合式逻辑：状态机 / 计时器 / 注册（纯 TS，可单测）
├── VaToolCallCard.vue     # 薄模板：模板 + 组装 composable，<script setup> 不写业务
└── VaToolCallCard.css     # 独立样式文件，SFC 以 <style src> 引入（非 scoped，BEM + va- 前缀）
```

- **逻辑进 TS**：状态与副作用一律写在 `useXxx.ts` 组合式函数里（props 进、返回响应式状态与操作函数），`.vue` 只负责模板装配——强化类型检查与复用
- **样式进 CSS**：从 SFC 抽出独立文件；M3 的 registry 生成器会把 CSS 内联回单文件（保持"单文件拷贝"分发形态）
- **共享逻辑沉淀 composables**：`useNow`（实时时钟）、`useCountdown`（倒计时）等跨组件复用，也可被宿主应用导入
- CSS 变量引用一律带 fallback：`var(--va-ink, #1a1917)`
- 每组件暴露局部覆盖变量（如 `--va-btn-ink`），全局令牌 `--va-*` 一处改全库变
- 图标内联 SVG；禁止引入任何 UI/动画库

### 3.2 设计令牌（Calm 色板，tokens.css）

```css
/* 亮色（:root 默认） */
--va-bg: #f7f6f2;            /* 暖纸底 */
--va-bg-subtle: #efede7;     /* 次级面（骨架屏底、代码底） */
--va-card: #ffffff;          /* 卡片面 */
--va-ink: #1a1917;           /* 主墨色 */
--va-ink-2: #43413c;         /* 次级文字 */
--va-muted: #6f6d66;         /* 弱文字 */
--va-edge: rgba(26,25,23,.12);
--va-edge-strong: rgba(26,25,23,.22);
--va-accent: #c2410c;        /* 陶土橘（品牌强调） */
--va-accent-hover: #9a3412;
--va-accent-soft: rgba(194,65,12,.10);
--va-success: #1a7f4b;  --va-warning: #b45309;  --va-danger: #d5453c;  --va-info: #2563eb;

/* 暗色（[data-theme="dark"] 与 .dark 双选择器，暖黑） */
--va-bg: #141311;  --va-bg-subtle: #1b1917;  --va-card: #1e1c1a;
--va-ink: #f0eee9; --va-ink-2: #c9c6bf;      --va-muted: #98948b;
--va-edge: rgba(240,238,233,.14);  --va-edge-strong: rgba(240,238,233,.26);
--va-accent: #e8925e; --va-accent-hover: #f0a87d; --va-accent-soft: rgba(232,146,94,.14);
--va-success: #4cc38a; --va-warning: #e5a53a; --va-danger: #f07168; --va-info: #7ab0f5;

/* 圆角 / 间距 / 阴影 / 动效 / 字体（两套主题共用） */
--va-radius-s: 8px; --va-radius-m: 10px; --va-radius-l: 16px; --va-radius-pill: 999px;
--va-s1: 2px; --va-s2: 4px; --va-s3: 8px; --va-s4: 12px; --va-s5: 16px; --va-s6: 24px; --va-s7: 32px;
--va-shadow-1: 0 1px 2px rgba(26,25,23,.06);   /* 暗: .3 黑 */
--va-shadow-2: 0 4px 12px rgba(26,25,23,.08);  /* 暗: .35 */
--va-shadow-3: 0 12px 32px rgba(26,25,23,.12); /* 暗: .45 */
--va-ease: cubic-bezier(.22, 1, .36, 1);
--va-dur-1: 120ms; --va-dur-2: 200ms; --va-dur-3: 300ms;
--va-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
--va-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

### 3.3 主题接入约定

- 宿主亮/暗切换：设置 `<html data-theme="dark">` 或加 `.dark` 类，**组件零感知**
- "跟随系统"由宿主实现：`matchMedia('(prefers-color-scheme: dark)')` 监听后设置上述属性
- 定制主题：覆盖任意 `--va-*` 变量即可全库换肤，无需 JS 主题引擎

## 4. 组件规划（3 期 × 20 个）

| 期 | 组件 | 数量 |
|---|---|---|
| **P1 Agent-Ops 旗舰** | VaToolCallCard(+Group)、VaAgentPlan、VaApprovalCard、VaAgentInbox、VaDecisionInbox、VaContextWindow、VaInlineDiff、VaMemoryPanel | 8 |
| **P2 Chat 配套** | VaThinkingLoader、VaMessageActions(+VaMessageText)、VaComposer、VaModelPicker、VaStreamAnswer | 5 |
| **P3 基础/动效** | VaButton、VaSegmentedControl、VaToaster、VaSkeleton(+VaShimmerText)、VaNumberTicker、VaTextReveal、VaGridBackground | 7 |

**统一验收标准**：可运行 demo ✓ · props/emits 文档 ✓ · 键盘 + aria ✓ · reduced-motion 降级 ✓ · SSR 安全 ✓ · registry 可单文件安装 ✓

**组件 API 约定**：
- 枚举对齐 affectUI：`size: sm/md/lg`、`variant: primary/secondary/ghost/destructive`、`status: running/success/error`、置信度 `signal: 0-3`
- 时间参数统一毫秒（`startedAt` / `duration`），与 agent 事件流直连
- `v-model` + 显式 `emits`；`icon` slot 可替换内置 SVG；事件名 camelCase
- **布尔 props 警告**：不要用 `defineModel` 表达可选布尔（Vue 布尔 cast 使未绑定值为 `false`，无法区分"未绑定"与"绑定 false"）——用 `props.open !== undefined` 判定受控 + touched 哨兵回落 `defaultOpen`（参见 ToolCallCard）

### 4.1 缺口规划（M5–M7，对标 affectUI 全量 103+ 项）

**覆盖率现状（M5 后）**：Components 29/49（59%，含 4 个差异化超集）· Screens 0/12 · Blocks 0/11 · Illustrations 0/24 · Motion 4/8。Pro 组件 21 个中已对标 14 个。

**差异化机会——affectUI 没有的 agent 客户端刚需（4 个，超越对标的卡位）**：

| 组件 | 说明 | 优先级 |
|---|---|---|
| **VaCodeDiff** | 文件级代码 diff（±行渲染、行内词级高亮、折叠上下文）——agent 改代码的验收主界面 | ★★★ |
| **VaFileTree** | 文件树（变更标记 M/A/D、目录折叠、点击回调） | ★★★ |
| **VaTerminalLog** | 命令输出流（等宽、ANSI 常用色、自动滚动、行复制） | ★★★ |
| **VaCheckpointList** | 检查点/回滚列表（每步快照、diff 预览入口、一键恢复） | ★★ |

**M5 · Agent 客户端刚需批（≈2 周，9 个）**：VaCodeDiff、VaFileTree、VaTerminalLog、VaCheckpointList（差异化 4 件）+ VaCommentThread(Free)、VaEmailDraft(Free)、VaUsageMeter(Pro)、VaCommandMenu(Pro)、VaDropzone(Pro) —— ✅ 已交付

**M5 交付要点**：
- 新增 utils：`lineDiff`（LCS 行级 diff + hunk 折叠 + 行内词级配对）、`parseAnsi`（SGR 常用色含 256/真彩、`\r` 进度条重写、其余 CSI 剥除）；共享 `useCopyable` composable
- `buildFileTree()`：扁平 git 变更列表 → 文件树（目录优先字母序），agent 后端可直接喂
- 键盘/aria：FileTree 完整 treeitem 方向键导航；CommandMenu ⌘K 面板（过滤、循环高亮、焦点圈进/恢复、Esc/遮罩关闭）；CheckpointList 恢复二次确认（3s 窗口）
- 受控模式：CommandMenu 遵循布尔哨兵约定（`open !== undefined` 判受控）；Dropzone/EmailDraft 全受控由宿主驱动
- 验证方式：52 vitest（含 12 个 SSR renderToString smoke——组件可渲染 + SSR 安全双证）；playground M5Demo 编排成"agent 验收工作台"场景
- 顺带修复 M3 遗留：meta 中 skeleton 的 `dir` 误写（registry 一直缺该条，现为 29 条全量）

**M6 · Pro/Free 输入·表单·导航·反馈批（≈2-3 周，16 个）**：VaCombobox(Pro)、VaStepperForm(Pro)、VaPromptLibrary(Pro)、VaSetupGuide(Pro)、VaDateRangePicker(Pro)、VaIntegrationPicker(Pro)、VaIntegrationSettings(Pro)、VaFilterMenu(Free)、VaNotificationStack(Free)、VaOtpInput(Free)、VaProfileMenu(Free)、VaProgressTracker(Free)、VaSmartRecommendation(Free)、VaTipsPanel(Free)、VaReactionBar(Free)、VaChangeSummary(Free)

**M7 · 数据图表 + Screens/Blocks 精选 + 装饰尾巴（≈2-3 周）**：
- 数据展示（5，**手写 SVG 零依赖**）：VaKpiChart、VaBreakdownChart、VaCompactBreakdown、VaExperimentCard、VaAiAnswer（含来源卡/引用，吸收 Cited Answer 场景）
- Screens 精选（5，只做高频"模板"不全量）：AppShell、AgentChat、AgentRun、Onboarding、SettingsBilling
- Blocks 精选（3）：TaskBoard、PricingPlans、AIWorkspace
- Motion 补齐（4）：VaTiltCard、VaBlurCrossfade、VaGradientFloor、VaGradientText
- 插画精选（3，装饰引流）：VoiceOrb、AgentTeam、ModelWheel

**累计：M5–M7 后全库 ≈ 63 个目录**，Components 层对标率 ≈ 88% + 4 个差异化超集。

**技术决策点**：
1. 图表类手写 SVG sparkline 级（守零依赖）vs 引图表库 → **选 a**
2. Data Table 暂不做（客户端 MVP 无表格需求；出现时再选 TanStack headless vs 手写）

**暂缓清单**：Billing Schedule、Comments Panel、Writing Assistant、Project Card（低频）；CRM/Analytics/Evals/Folder 系 Screens（非目标场景）；插画全量（只留 3 个招牌）。

## 5. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1**（第 1 周） | monorepo 骨架 + tokens + VaButton / VaSkeleton / VaShimmerText / VaNumberTicker 打样定风格 | ✅ 本次完成 |
| **M2**（2-3 周） | P1 旗舰 9 组件 + playground 拼出"agent 运行页"雏形 + vitest | ✅ 已完成 |
| **M3**（第 4 周） | P2/P3 + VitePress 文档站 + llms.txt + registry 生成器 + dts/publishConfig + npm 0.1.0 | ✅ 已完成（npm 0.1.0 首发 待 registry 托管地址） |
| **M4**（精修轮） | 交互与可达性：真实按键走查、focus-visible、动效参数审计、修复回归 | ✅ 已完成 |
| **M5**（≈2 周） | Agent 客户端刚需批：差异化 4 件（CodeDiff/FileTree/TerminalLog/CheckpointList）+ 对标 5 件（CommentThread/EmailDraft/UsageMeter/CommandMenu/Dropzone） | ✅ 已完成（52 tests 含 SSR smoke；registry 29 条） |
| **M6**（≈2-3 周） | Pro/Free 输入·表单·导航·反馈批 16 个 | 📋 规划 |
| **M7**（≈2-3 周） | 数据图表 5 + Screens 精选 5 + Blocks 精选 3 + Motion 4 + 插画 3 | 📋 规划 |

## 6. 发布前 TODO（M3 清单）

- [x] `vite-plugin-dts` 产出类型；`publishConfig` 切换 exports 到 dist
- [x] registry JSON 生成脚本（每组件一条，含 `files[]` 内容内联）— `pnpm registry`，19 items
- [x] llms.txt / llms-full.txt 生成 — `pnpm llms`
- [x] VitePress 文档站（指南 + 组件总览 props 表；live demo 后续增强）
- [x] changesets + CI（build + typecheck + test + registry/llms + docs）

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 做库易、分发难 | 文档站/llms.txt/MCP 是一等公民；20 个精品组件优先于数量 |
| React 侧创新快 | 以"模式定义者"姿态独立设计，不逐个搬运 |
| SSR/版本兼容 | 第一天守 SSR 纪律；只支持 Vue 3.5+ |
| 单人维护 | 组件少而精；P1 未稳前不扩 P2/P3 |
