# @vuagent/ui

Vue 生态的 Agent Ops 组件库：为 AI agent 产品的运行时操作界面（计划 / 审批 / 工具调用 / 上下文 / 收件箱 / 轨迹）而生的 73 个强类型 Vue 3 组件。

## 定位

AI agent 产品的前端缺的不是通用 UI 库，而是**运行时操作界面**：agent 的执行计划怎么展示？危险操作谁来审批？工具调用链、上下文水位、后台任务收件箱长什么样？本包把这一层沉淀为可整包安装、也可单文件拷贝的组件集：

- **薄模板 + 独立样式 + 强类型 + composable 逻辑**——每个组件一个目录，逻辑与视图分离；
- **零运行时依赖**——peer 仅 `vue ^3.5`，图标随构建内联，装完即用；
- **亮暗双主题**——`:root` 上的 `--va-*` 设计令牌一键换肤；
- **动效尊重系统**——全部动效尊重 `prefers-reduced-motion`。

## 架构

### 双子系统：静态组件 × Agent Runtime

包由两个语义层级构成：

1. **静态组件层**（73 个 Va* 组件）：不依赖任何运行时上下文的独立组件，按 Agent-Ops / Chat / 基础 / 动效 / 表单 / 反馈 / 图表 / Screens / Blocks / Illustrations 十个域组织；
2. **Agent Runtime 子系统**：让静态组件「活起来」的装配层——组件注册表、流式状态机、动态渲染分发器、动作回传客户端。

```
宿主应用
   │ useAgentChat()          ← 前端流式状态机（SSE → MessageBlock 混排流）
   ▼
VaAgentRenderer             ← 动态分发器（注册表查表 → 骨架/渐进决策 → 入参守卫 → 动作回传）
   │  查表 ▼
组件注册表（registry）       ← 组件名 → { 组件, 骨架屏, 渐进渲染开关, propAdapter }
   │  回传 ▼
actionClient                ← POST /api/action/:actionId → 服务端唤醒挂起协程
```

### 组件单元：逻辑与视图分离

每个组件遵循同一单元结构：模板保持薄（只做布局与语义绑定），交互逻辑收敛进独立 composable，样式独立成文件随构建聚合或随 registry 拷贝分发，类型独立导出。这个结构的直接收益：

- **逻辑可脱离挂载测试**——审批倒计时、diff 算法、吸底滚动等纯逻辑用 vitest 直测，不需要渲染 Vue 组件；
- **单文件拷贝可行**——registry 通道分发时，composable 与 utils 已内联进组件文件，拷走即可用。

### 设计令牌的三层模型

```
L1 基础令牌   色彩/间距原始值（换肤只改这一层）
   └→ L2 语义令牌   排版/尺寸/层级/动效档位（从 L1 派生的规范档位，组件不得绕过裸写）
        └→ L3 组件钩子   --va-<组件>-*（各组件自定义的局部可调项）
```

亮色为 `:root` 默认，暗色由 `[data-theme="dark"]` / `.dark` 双选择器承载，切换职责在宿主。三层结构保证：换一个主题 = 改一层变量；改一个组件的局部样式 = 只碰自己的钩子。

### 双分发通道

| 通道 | 形态 | 自包含策略 |
|---|---|---|
| npm 整包 | vite lib 构建（ES + dts），样式聚合成单一 CSS，`vue` external | 契约类型以 vendored 副本随包分发（见下） |
| shadcn-vue registry | 74 个单文件 JSON 条目，`npx shadcn-vue add` 直接落文件 | 同目录引用随条目携带；组件间引用声明为 `registryDependencies`；共享 composables/utils 由生成器**内联**进文件 |

registry 的自包含性是机械校验的不变量而非约定：CI 扫描每条目的全部相对 import，任何悬空引用即失败。这保证了「单文件拷贝」通道永远不会交付一个跑不起来的半成品。

### 契约副本与 CI 同步

npm 发布物内零 workspace 依赖，因此与 `@vuagent/protocol` 共享的组件生命周期类型以 vendored 副本随包分发。副本**不由人工编辑**：改协议 → 改 protocol 包 → 同步脚本按提示更新副本，CI 卡口机械对比两侧（类型名集合、生命周期字面量、逐名声明文本），漂移即失败。

## 核心设计决策

### Tree-shaking 是结构属性，不是配置项

组件注册表**刻意不携带任何模块顶层副作用**（不在模块作用域初始化内置组件），否则只 import 一个 VaButton 的宿主也会被打入全部组件。注册初始化改为运行时显式调用（状态机内部兜底幂等触发），CSS 以 `sideEffects` 声明保留。这让「用多少、装多少」在打包器层面成立。

### 模型输出 = 不可信输入

流式阶段到达的组件参数可能为 null、非对象、字段类型错乱——它来自大模型的自由生成。渲染分发器在参数进入组件前统一做空值与类型守卫（对象兜底、字符串/数字/布尔/数组/枚举逐类收窄），由各组件的 propAdapter 消费。裸取 `args.xxx` 导致的渲染崩溃与脏值透出，在入口被结构性排除。

### 渐进渲染 + 骨架屏降级

每个注册条目可声明 `progressive` 开关与专属骨架屏。策略按业务语义分档：表单/审批类组件的参数可随模型逐行输出**渐进出现**（用户提前看到表单轮廓）；图表/diff 类组件数据残缺时渲染无意义，流式阶段显示骨架屏、数据完整后切换实体。分发器集中裁决，组件自身无感知。

### 动效分频

`prefers-reduced-motion: reduce` 时不做一刀切，而是按动效性质分频：装饰性循环动画（微光/呼吸/漂浮）全部关闭；功能性动画（浮层进出/按压反馈/数字滚动）降级为纯 opacity 过渡——**保留状态可感知性**，只去掉位移。

### 危险操作默认拒绝

审批类组件的键盘语义以安全为默认：Enter 与 Esc 均映射**拒绝**，避免误触一键放行高危操作；仅当宿主显式开启批准快捷键时 Enter 才映射批准。倒计时归零自动拒绝——挂起的审批不会无限期阻塞执行链路。

## 业务逻辑

### 前端流式状态机

`useAgentChat` 把一次 SSE 轮次收敛为 **MessageBlock 混排流**：一条助手消息是「文本块 + 组件块」的有序序列，支持模型「先说一段 → 插入图表 → 再总结 → 插入审批单」的任意混排。收敛规则：

- 文本增量：与末尾文本块合并，否则新开文本块；
- 组件四段事件（参数流式生成 → 执行中 → 结果）：按 `toolCallId` 寻址对应组件块原地更新状态与载荷；
- HITL 挂起/恢复事件：驱动组件块的 `executing ⇄ done` 迁移与决策回写。

### 共享流式消费件（宿主可复用）

状态机底座的三个公共件已独立导出，宿主自建流式数据域时可复用同一实现（与 `useAgentChat` 内部零差异）：

- **`consumeSSEStream<T>`**：SSE 消费循环——泛型事件类型、跨 chunk 半包/CRLF/多行 data 合并、`[DONE]`/本地中止分类、`onParseError` 解析失败钩子（单块损坏不拖垮整条流）。传输完全由 `open()` 扩展点掌控（POST 发起 / GET 重连 / 鉴权 / 代理）。
- **`parseSSEChunk`**：纯函数块解析（增量 chunk + 残余 buffer 线程），供需要自定义消费循环的场景。
- **`createDeltaBuffer`**：文本增量 rAF 合帧缓冲（`push`/`flush`/`drop` 纪律 + 陈旧帧防御）；`scheduler` 可注入（worker / 节流 / 测试手动跑帧），无 rAF 环境同步降级。

```ts
import { consumeSSEStream, createDeltaBuffer } from "@vuagent/ui";

const buffer = createDeltaBuffer({ commit: (text) => (block.content += text) });
await consumeSSEStream<UIStreamEvent>({
  open: () => fetch("/api/chat", { method: "POST", body }),
  onEvent: (e) => (e.type === "text_delta" ? buffer.push(e.delta) : reduce(e)),
  onDone: () => buffer.flush(),
});
```

### HITL 动作回传链路

审批卡 / 表单的提交经统一回传通道：分发器封装了 API 直发（`POST /api/action/:actionId`）与宿主回调两条路径，失败语义显式（提交失败即上报 error 并中止，宿主不会把网络故障误记为已决策）。服务端唤醒挂起协程后，执行链路带着用户决策继续走，前端组件块随之收敛为只读回执态。

### 组件承载的业务语义

Agent-Ops 旗舰组件各自内聚一段业务逻辑：执行轨迹按 lane（输入/模型/工具）× role 分道回放；上下文仪表按系统提示/历史/工具三段渲染水位与 tooltip；决策收件箱聚合跨会话的挂起审批并支持跳转；工具调用卡按四段状态渐进收敛（含半截参数的容错展示）；终端日志卡内建 ANSI 解析。

## 安装

三条通道详见根 [README](../../README.md#安装三条通道)：npm 整包（`@vuagent/ui`）、shadcn-vue registry 单文件拷贝、llms.txt 供 AI 编码工具检索。组件 Props 明细见[文档站](https://hellotombruce.github.io/vuagent/)。

## 测试与构建

```bash
pnpm --filter @vuagent/ui test        # vitest：逻辑单测 + SSR 快照 + DOM 行为测试
pnpm --filter @vuagent/ui build       # vite lib 构建（ES + 类型 + 聚合 CSS）
pnpm registry && pnpm registry:check  # 重新生成 registry 工件 + 自包含校验
```
