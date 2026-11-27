# AGENTS.md — Agent 协作红线与工作规范

> 本文件是 AI Agent（Claude / Kimi / GLM / 其他）在本仓库工作的硬性约束。**红线没有例外，不因上下文紧急、任务宏大或"顺手"而豁免。** 与本文件冲突的既有习惯，以本文件为准。

## 🚫 红线（违反即事故）

### 1. 发布（publish）必须用户明确要求

- **任何** npm 发布动作——`pnpm publish`、`npm publish`、`changeset publish`、移动/删除已推送的发布 tag、触发 `Publish` workflow（含改 tag 间接触发）——**只能在用户明确提出（如"发布""发版""推 next"）后执行**。
- "顺手验证一下能不能发"、"dry-run 之外补一步真发"、"重跑一下 workflow"若会触发发布，都在禁止之列。
- 搜索/查看 registry、`npm view`、`npm pack --dry-run`、`npm publish --dry-run` 等只读探测不在此限。

### 2. 提交（commit）必须用户明确要求

- **不主动 `git commit`。** 完成实现与验证后，停在"改动完成、未提交"状态，向用户报告并等指令（如"提交""提交并推送"）。
- 用户说"提交"≠"推送"：`push` 需要**单独**的明确要求（"提交并推送"才算同时授权两个动作）。
- 唯一例外：`git add`（暂存）可以在准备提交说明前做，但 staged 状态就停下等指令。

### 3. 推送（push）必须用户明确要求

- **不主动 `git push`**（任何分支、任何 tag）。包含：push 代码、push tag、删除远端 tag/分支、force push。
- 间接触发式动作按触发后果定性：会触发 `Publish` workflow 的 push（如推 `v*` tag）**同时受红线 1 约束**——即使用户要求了"推送"，移 tag 这种会触发发布的行为也要单独确认。

### 4. 不可逆 / 影响远端的动作先问

- 关闭他人 PR、删除 release/issue/comment、改仓库设置（Actions 权限、分支保护、secret）、`gh pr merge`、修改 npm 包元数据（deprecate/dist-tag 调整）——即使用户之前做过类似操作，每次都要先问。

### 5. 敏感数据不出仓

- `.env*`、token、密钥、数据库文件（`*.db*`）、`tasks/`（本地工作日志）不进 commit；发现 diff 里有立即撤出并告知用户。

## ✅ 默认授权（无需每次确认）

- 读代码、跑测试、typecheck、build、本地验证（起本地服务、curl 本地端口、临时目录安装验证）；
- 编辑源码/文档/测试，写 `docs/design/**` 设计文档与 `tasks/todo.md` 工作日志；
- 查询 GitHub（`gh pr view`、`gh run list/watch`、拉日志）与 npm registry（只读）；
- 本地分支操作（建分支、切分支）；`git add`。

## 📐 工作方式

1. **计划先行**：非琐碎任务先出方案（`docs/design/**` 或对话内计划），重大取舍列"待拍板"，用户点头再动手。
2. **验证后报告**：声称"完成/修复/通过"必须先跑过验证命令、贴出证据（测试数、exit code、真机行为）；失败如实说，不粉饰。
3. **实证纠错**：断言失败先怀疑测试假设与遗漏的清理（僵尸进程、端口占用、缓存），用最小复现定位，而不是改产品代码迁就测试。
4. **顺手修复要留痕**：评审中发现的实证问题（如本次的 pre-mode `--tag`、serveStatic header 行为），修在对应 PR/提交里并在 commit message 写明根因。
5. **收尾三件套**：交付 = 代码 + 测试 + 文档/changeset；缺一不算完成（用户另有指示除外）。
6. **被动等待即停**：到达人工门（PR 审阅、发布指令、拍板项）后停止并清楚说明"等什么、下一步是什么"，不轮询、不催促、不代填人工决策。

## 📋 仓库速查

- monorepo（pnpm workspace）：`packages/{protocol,server,ui,console(console-app 源码库),cli}` + `apps/{console(=@vuagent/console 生产薄壳),playground(私有 dev 壳),docs}` + `examples/*`
- 本地调试（改完立刻看见，不发布）：`pnpm console`（console HMR）｜`pnpm cli:dev`（CLI 源码直跑）｜`pnpm cli:smoke`（发布前的用户视角冒烟，含样式自足性）——详见 [docs/contributing/local-debugging.md](./docs/contributing/local-debugging.md)
- 门禁：`pnpm typecheck` → `pnpm test` → `pnpm build` → `pnpm registry`/`llms` 后 `git diff` 工件新鲜度 → `pnpm registry:check` → `node scripts/check-pack.mjs` → `pnpm cli:smoke`（发布前）
- 发布链：`Release`（version PR，人工合并）→ 打 tag `v<version>` → `Publish`（门禁→发布→冒烟）。详见 `.github/workflows/publish.yml` 头注释与 `docs/design/v0.7-plan.md`
- 本地任务日志：`tasks/todo.md`（gitignore，不进 commit）
