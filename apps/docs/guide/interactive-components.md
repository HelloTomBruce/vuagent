# 可交互组件（L0–L3）

> Vuagent 的组件不只是 Agent 输出的**渲染终点**——三个旗舰组件把用户变成执行链路的一等参与者：审批决策、表单值采集、协作计划编辑。用户的输入以**契约化信封**回传，模型收到的是语义自解释的结果，而不是裸 JSON dump。
>
> 自定义你自己的可交互组件见[自定义交互组件（interaction 契约）](/guide/custom-interactive-components)；回传端点与响应规范见 [HITL 动作与审批回调](/protocol/actions)。

---

## 交互能力分级

组件注册时声明 `interaction.level`，等级决定三件事：服务端是否挂起协程、前端是否透传回传回调、超时的语义归属。

| 等级 | 语义 | 组件 | 用户做什么 |
|---|---|---|---|
| **L0 展示** | 只渲染，无回传通道 | VaTrajectory / VaCodeDiff / VaMetricChart / VaFileTree / VaTaskBoard 等 | 阅读、本地展开折叠 |
| **L1 决策** | 有限决策集（approve / deny） | [VaApprovalCard](/components/agent-ops#_1-vaapprovalcard-人机协同审批门) | 批准或驳回一次高风险操作 |
| **L2 表单** | 结构化值采集 | [VaForm](/components/agent-ops#_15-vaform-ui-form-表单卡)（ui_form） | 填写六型字段表单并提交 |
| **L3 协作** | 增量编辑 + 显式终态 | VaAgentPlan（`collaborative: true`） | 编辑计划步骤、确认或放弃 |

---

## 三条交互链路

### L1 · 审批决策——「这件事做不做」

高风险工具调用时执行协程整体挂起，VaApprovalCard 呈现风险徽章与参数预览。用户批准 → 放行执行；驳回 / 超时 → 以**非错误摘要**唤醒模型（明确告知「这是用户的决定，不要换汤不换药重试」）。键盘语义安全默认：Enter / Esc 均为拒绝。

### L2 · 表单采集——「参数是什么」

模型发起 `ui_form`（六型字段：text / textarea / number / boolean / select / date），执行协程**无审批挂起**，用户在 VaForm 中填写：

- **校验失败是重填的新输入而非终态**：必填缺失前端本地拦截；服务端复核失败回 422 + 逐字段错误，就地回显、修正后重提交——模型全程不被打断；
- **secret 通道**：令牌类字段值剥离入 secret store，模型只见 `{ref, masked}` 占位（「已收到 sk-…****」），后续经引用使用、执行点还原——明文永不进入模型上下文；
- **模型精确理解值**：回传结果为「语义摘要 + JSON 附录」双层格式——`production` 回映为「生产（8C16G）」、布尔渲染「是 / 否」、单位后缀跟随、默认值与用户修改分别标注。

### L3 · 协作计划——「计划怎么改」

模型发起 `ui_agent_plan` 并声明 `collaborative: true`（缺省纯展示，存量行为不变），计划卡进入协作态：

- 用户**编辑 / 增删 / 排序步骤** → `patch` 增量信封，服务端暂存（**不唤醒模型**，可多次增量）；
- 点「确认计划」→ 空提交，服务端合并全部增量后校验、唤醒——模型收到的是用户改完的最终计划；
- 点「放弃」/ 超时 → cancel 语义（放弃 ≠ 失败，模型不重试轰炸）。

---

## 公共支撑机制（组件无关）

| 机制 | 行为 |
|---|---|
| 渲染层统一守卫 | 非 executing 态（参数半截 / 已决策 / 出错）提交一律拦截——半截 JSON 渲染的表单不允许提交 |
| 双层校验 | 前端本地预校验（省必败往返）+ 服务端边界复核（权威）；回传值 Schema 由字段定义**派生**，模型无法自行放宽 |
| 统一信封 | `submit` / `cancel` / `patch` 判别联合 + `meta.editedFields`（用户亲自修改 vs 默认值透传，模型据此区分意图） |
| 超时裁决 | 只由服务端生成（L1 缺省 deny / L2·L3 缺省 cancel），不允许客户端伪造 |
| 重放幂等 | 同 actionId 同体重放 200 不重复处理、异体 422 拒绝；决策落账持久化（Redis 24h TTL / SQLite 行存），进程重启后重放仍幂等 |

---

## 下一步

- 直接使用：三个组件的 props / 事件 / demo 见 [Agent-Ops 旗舰组件](/components/agent-ops)；
- 自定义一个：[自定义交互组件（interaction 契约）](/guide/custom-interactive-components)——声明 `interaction` + 在 `propAdapter` 里绑定信封发射即可；
- 协议细节：[HITL 动作与审批回调](/protocol/actions)（信封形状 / 响应码全表 / 三条链路时序图）。
