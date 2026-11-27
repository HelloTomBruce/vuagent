# 本地调试 CLI 与 console（不发布也能看到真实效果）

> 背景：0.7.0 发布后发现「生产 console 样式全崩」——包能装、服务能起，但产物里没有
> `--va-*` 设计令牌。这类缺陷**打包审查看不出、单测看不出**，只有「按用户视角真跑一遍」
> 才暴露。下面的四条路径按「改完到看见」的耗时从短到长排列。

## 1. 改 console 界面：HMR（秒级）

```bash
pnpm console        # = server(6880) + apps/console dev(6996)，concurrently 并起
# 浏览器打开 http://localhost:6996/console
```

- `apps/console` 是 Vite dev server，`/api` 代理到 6880；
- 改 `packages/console/src/**`（组件/composable/样式）**热更新即时生效**，不用重建、不用发布；
- 端口冲突时改 `apps/console/vite.config.ts` 的 `server.port` 与 proxy 目标。

## 2. 改 CLI 自身（命令、参数、doctor/backup/migrate…）：源码直跑

```bash
pnpm cli:dev                      # 默认：数据目录 .tmp/cli-dev-home + 用 apps/console/dist
pnpm cli:dev -- --port 6999       # 追加参数原样透传给 vuagent
pnpm cli:dev -- --data-dir ~/.vuagent   # 想用真实数据时（谨慎）
```

- 走 `tsx packages/cli/src/main.ts`，**CLI / server / console-app 的改动都不需要打包**；
- 数据默认落在仓库内 `.tmp/cli-dev-home`（gitignored），不会污染你的 `~/.vuagent`；
- console 产物缺失时会先自动构建一次；**改了 console 源码后要重新构建**（或用路径 1 的 HMR）；
- 断点调试：`node --inspect-brk` 不方便时，直接用编辑器对 `packages/cli/src/main.ts` 下断点跑。

## 3. 发版前「用户视角」冒烟：`pnpm cli:smoke`（发布门禁）

```bash
pnpm cli:smoke          # 约 1 分钟
pnpm cli:smoke --keep   # 保留临时目录（排查用，会打印路径）
```

做的事：`pnpm pack` 五个包 → `npm i -g --prefix <tmp>` → 真跑 `vuagent` → 断言：

| 断言 | 抓什么 |
|---|---|
| `vuagent --version` | 可执行文件缺失 / shebang / 包入口错 |
| `/api/health` 200 | 服务起不来、依赖缺失（`workspace:*` 未置换等） |
| `/console` 返回 SPA 入口 | console 资源没随包发布 / 包内解析失败 |
| 引用的 CSS 含 `--va-bg`、`.va-console`、满高布局 | **样式不自足**（0.7.0 事故） |
| 第二实例 exit 3 | 单实例锁失效 |
| SIGINT exit 0 且锁删除 | 优雅停机 / 锁泄漏 |

**反向验证**（做一次就懂它的价值）：把 `packages/console/src/index.ts` 里的
`import "@vuagent/ui/tokens.css"` 删掉 → `pnpm --filter @vuagent/console build` →
`pnpm cli:smoke` 会在「样式不自足」处失败。也就是说 0.7.0 的缺陷现在本地就拦住。

## 4. 想连真实 npm 发布物：临时 prefix 安装

```bash
npm i -g --prefix /tmp/vuagent-test @vuagent/cli@0.7.0
PATH=/tmp/vuagent-test/bin:$PATH VUAGENT_HOME=/tmp/vuagent-test-home vuagent
```

用来确认「已发布的版本」是否真的能用（与本地区别：走 registry、走包内 console 解析）。

## 验收命令清单（提交前跑）

```bash
pnpm typecheck && pnpm test          # 单测
pnpm build                           # 全包构建（含 apps/console 产物）
pnpm tokens:check && pnpm registry:check
node scripts/check-pack.mjs          # 包内容审查（含 console 样式自足性）
pnpm cli:smoke                       # 用户视角冒烟（发布前必跑）
```

## 已知坑（都踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| `pnpm cli:dev -- --port x` 报「未知选项 --」 | pnpm 把分隔符也传进来 | 脚本已剥掉；自定义脚本注意 |
| console 改完本地没变化 | `cli:dev` 用 `apps/console/dist` 静态产物 | 重跑 `pnpm --filter @vuagent/console build`，或用路径 1 的 HMR |
| 装完 `vuagent` 命令找不到 | npm 全局 bin 不在 PATH | `npm prefix -g` 看路径；或 `--prefix` 版直接用绝对路径 |
| 页面样式全崩、`--va-bg` 为空 | console 产物缺 tokens.css（0.7.0 事故） | 已由库入口引入 + `check-pack`/`cli:smoke` 双门禁兜住 |
