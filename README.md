# Vuagent（代号）

Vue 生态第一个 **Agent Ops 组件库**——为 AI agent 产品的运行时操作界面而生：计划、审批、工具调用流、上下文窗口、任务收件箱。全 MIT 开源，零运行时依赖，单文件可拷贝。

- 设计与架构文档：[DESIGN.md](./DESIGN.md)
- 视觉风格：暖静 Calm（亮暗双主题，跟随系统）
- 前缀：类名 `va-`，CSS 变量 `--va-`

## 快速开始

```bash
pnpm install
pnpm build        # 构建所有包
pnpm typecheck    # 全仓类型检查
```

## 包结构

| 路径 | 说明 |
|---|---|
| `packages/ui` | 组件库本体（`@vuagent/ui`） |
| `apps/playground` | 本地预览应用（`pnpm --filter @vuagent/playground dev`） |
| `apps/docs` | (M3) VitePress 文档站 |

## 进度

- [x] M1：骨架 + tokens + 打样组件（VaButton / VaSkeleton / VaShimmerText / VaNumberTicker）
- [x] M2：P1 旗舰 9 组件（ToolCallCard/Group / DecisionInbox / ApprovalCard / AgentPlan / AgentInbox / ContextWindow / InlineDiff / MemoryPanel）+ vitest + playground「Agent 运行页」雏形
- [x] M3：P2/P3 组件补齐（9 个新组件，全库 22 个）+ registry 生成器（19 items）+ llms.txt/llms-full.txt + dts/publishConfig + VitePress 文档站 + CI/changesets
- [x] M4：交互与可达性精修（真实按键走查 / focus-visible / 动效审计）
- [x] M5：Agent 客户端刚需批 9 件——差异化 CodeDiff / FileTree / TerminalLog / CheckpointList + 对标 CommentThread / EmailDraft / UsageMeter / CommandMenu / Dropzone（全库 29 项，52 tests 含 SSR smoke）
