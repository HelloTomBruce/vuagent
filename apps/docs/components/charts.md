<script setup lang="ts">
import { ref } from "vue";
import {
  VaAiAnswer,
  VaBreakdownChart,
  VaCapabilityCard,
  VaCompactBreakdown,
  VaExperimentCard,
  VaKpiChart,
  VaMetricChart,
  VaNotificationStack,
  VaReactionBar,
  VaSmartRecommendation,
  VaTipsPanel,
} from "@vuagent/ui";

const kpiSeries = [12, 18, 15, 24, 32, 28, 45, 52];

const metricSeries = [
  { label: "10:00", value: 420 },
  { label: "10:15", value: 680 },
  { label: "10:30", value: 950 },
  { label: "10:45", value: 720 },
  { label: "11:00", value: 1280 },
];

function handleAction(id: string) {
  alert(`触发建议操作: ${id}`);
}

/* ---------- 4. VaBreakdownChart ---------- */
const breakdownItems = [
  { label: "read_file", value: 860 },
  { label: "web_search", value: 540 },
  { label: "edit_file", value: 420 },
  { label: "run_command", value: 310 },
  { label: "browser_use", value: 180 },
  { label: "sql_query", value: 90 },
];

const breakdownCostItems = [
  { label: "GPT-5 调用", value: 1860, color: "#6366f1" },
  { label: "Claude 调用", value: 1240, color: "#f59e0b" },
  { label: "DeepSeek 调用", value: 520, color: "#10b981" },
  { label: "Embedding", value: 140, color: "#94a3b8" },
];

const pickedBreakdown = ref("点击任意一行试试（@select）");

function handleBreakdownSelect(item: { label: string; value: number }) {
  pickedBreakdown.value = `已选中「${item.label}」· ${item.value} 次调用`;
}

/* ---------- 5. VaCompactBreakdown ---------- */
const compactSegments = [
  { label: "system", value: 1200, color: "#8b5cf6" },
  { label: "history", value: 6400, color: "#3b82f6" },
  { label: "files", value: 2800, color: "#10b981" },
  { label: "tools", value: 900, color: "#f59e0b" },
];

/* ---------- 6. VaCapabilityCard ---------- */
const capabilityDismissed = ref(false);

function handleCapabilityDismiss() {
  capabilityDismissed.value = true;
}

/* ---------- 7. VaNotificationStack ---------- */
const notifications = ref([
  { id: "n1", title: "任务执行完成", body: "「整理周报数据」已完成，共 12 个步骤，耗时 3 分 42 秒。", kind: "success", unread: true, createdAt: Date.now() - 5 * 60_000 },
  { id: "n2", title: "等待人工审批", body: "「删除过期日志表」需要你的批准，超时将自动拒绝。", kind: "danger", unread: true, createdAt: Date.now() - 18 * 60_000 },
  { id: "n3", title: "Agent 中途提问", body: "未找到 2024 年 Q3 销售数据表，是否改用 Q4 数据继续分析？", kind: "agent", unread: true, createdAt: Date.now() - 42 * 60_000 },
  { id: "n4", title: "Token 用量预警", body: "本月用量已达限额的 82%，建议开启 Prompt Cache。", kind: "warning", unread: false, createdAt: Date.now() - 3 * 3600_000 },
  { id: "n5", title: "工作区已同步", body: "agent-playground 已同步最新提交，无冲突变更。", kind: "info", unread: false, createdAt: Date.now() - 26 * 3600_000 },
]);

const notificationAction = ref("点击通知行或右上角「全部已读」试试");

function handleNotificationOpen(item: { id: string; title: string; unread?: boolean }) {
  item.unread = false;
  notificationAction.value = `已打开：${item.title}`;
}

function handleNotificationRead(id: string) {
  const target = notifications.value.find((n) => n.id === id);
  if (target) target.unread = false;
  notificationAction.value = `已单条标记已读：${id}`;
}

function handleNotificationAllRead() {
  notifications.value.forEach((n) => {
    n.unread = false;
  });
  notificationAction.value = "已全部标记已读";
}

/* ---------- 8. VaTipsPanel ---------- */
const tips = ref([
  { id: "t1", title: "用自然语言描述任务", body: "不必手动拆解步骤，agent 会自动生成执行计划并逐步推进。" },
  { id: "t2", title: "高危操作先过审批门", body: "删除文件、执行命令等敏感动作会先弹出审批卡请求确认。" },
  { id: "t3", title: "会话可随时回滚", body: "在轨迹视图中选中任一检查点，即可把会话恢复到当时状态。" },
]);

const tipAction = ref("点击单条右上角的 × 关闭（@dismiss）");

function handleTipDismiss(id: string) {
  tips.value = tips.value.filter((t) => t.id !== id);
  tipAction.value = `已关闭 ${id}，剩余 ${tips.value.length} 条`;
}

const fixTips = [
  { id: "f1", title: "类型检查失败", body: "先跑 pnpm typecheck 看完整报错，多数是类型收窄遗漏。" },
  { id: "f2", title: "依赖版本漂移", body: "对比 pnpm-lock.yaml 的最近变更，锁定可疑依赖后重装。" },
];

/* ---------- 9. VaReactionBar ---------- */
const reactions = ref([
  { id: "like", emoji: "👍", label: "有帮助", count: 24, active: false },
  { id: "insight", emoji: "💡", label: "有启发", count: 8, active: true },
  { id: "meh", emoji: "🤔", label: "待斟酌", count: 3, active: false },
]);

const singleReactions = ref([
  { id: "up", emoji: "👍", label: "回答准确", count: 46, active: true },
  { id: "down", emoji: "👎", label: "存在错漏", count: 2, active: false },
]);

const reactionAction = ref("点击 emoji 切换（@toggle 携带目标态）");

function handleReactionToggle(item: { id: string; label?: string }, nextActive: boolean) {
  const target = reactions.value.find((r) => r.id === item.id);
  if (target) {
    target.active = nextActive;
    target.count = Math.max(0, (target.count ?? 0) + (nextActive ? 1 : -1));
  }
  reactionAction.value = `「${item.label ?? item.id}」${nextActive ? "已选中" : "已取消"}`;
}

function handleSingleToggle(item: { id: string; label?: string }, nextActive: boolean) {
  singleReactions.value.forEach((r) => {
    r.active = r.id === item.id && nextActive;
  });
  reactionAction.value = `单选反馈「${item.label ?? item.id}」${nextActive ? "已选中" : "已取消"}`;
}

/* ---------- 10. VaExperimentCard ---------- */
const expStatus = ref<"running" | "success" | "error">("running");
const expStartedAt = ref(Date.now() - 26 * 3600_000);

const expVariants = [
  { id: "baseline", name: "对照组（原提示词）", value: 0.642, format: { style: "percent" as const, maximumFractionDigits: 1 } },
  { id: "rewrite", name: "实验组（改写提示词）", value: 0.731, format: { style: "percent" as const, maximumFractionDigits: 1 }, delta: 0.139, winner: true },
];

function handleExpStop() {
  expStatus.value = "success";
}

function handleExpReopen() {
  expStatus.value = "running";
  expStartedAt.value = Date.now();
}

const cacheVariants = [
  { id: "off", name: "关闭缓存", value: 0.312, format: { style: "percent" as const, maximumFractionDigits: 1 } },
  { id: "on", name: "启用 Prompt Cache", value: 0.407, format: { style: "percent" as const, maximumFractionDigits: 1 }, delta: 0.304, winner: true },
];

/* ---------- 11. VaAiAnswer ---------- */
const answerQuestion = "Vuagent 审批门的快捷键默认行为是什么？";

const answerText =
  "默认情况下，审批卡的 Enter 与 Esc 都会执行「拒绝」，避免误触回车放行高危操作 [1]。只有显式开启 approveShortcut 后，Enter 才会被启用为「批准」 [2]。";

const answerSources = [
  { id: "s1", title: "审批卡：快捷键安全默认", origin: "docs.vuagent.dev", url: "https://docs.vuagent.dev/components/approval-card" },
  { id: "s2", title: "Approval Card Props 参考", origin: "github.com/vuagent", url: "https://github.com/vuagent/vuagent/tree/main/packages/ui/src/components/approval-card" },
];

const pickedSource = ref("点击正文角标或底部来源行试试（@source）");

function handleSourcePick(source: { title: string; origin?: string }) {
  pickedSource.value = `已打开来源：${source.title}（${source.origin ?? "本地知识库"}）`;
}

const streamingAnswer =
  "正在汇总本周 47 次构建失败的原因：类型检查占 58%，依赖版本漂移占 24%，其余为环境变量缺失……";

const streamingSources = [{ id: "ss1", title: "CI 周报 · 构建失败归因", origin: "internal-ci" }];
</script>

# 反馈与数据可视化组件

> 提供零重型图表库依赖（纯手写轻量 SVG）、针对 AI Agent 业务指标分析与建议反馈的高性能展示组件。

---

## 1. VaKpiChart — 迷你趋势指标卡片

零外部图表依赖，使用纯 SVG 绘制平滑的 Sparkline 走势图，支持自动环比涨跌计算。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">核心 KPI 指标卡效果</div>
  <div class="demo-row">
    <div style="width: 280px;">
      <VaKpiChart
        label="今日 Agent 任务执行"
        :value="1428"
        :delta="0.24"
        delta-label="较昨日同期"
        :series="kpiSeries"
      />
    </div>
    <div style="width: 280px;">
      <VaKpiChart
        label="Token 平均单耗"
        :value="3200"
        :delta="-0.12"
        delta-label="较上周环比"
        :series="[4500, 4200, 3900, 3600, 3200]"
        invert-delta
      />
    </div>
  </div>
</div>

---

## 2. VaMetricChart — 时序折线/柱状指标图

用于大模型主动调用 `ui_metric_chart` 工具或业务端展示多时间维度的性能与业务数据走势。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">时序折线走势图</div>
  <VaMetricChart
    title="Agent 每分钟 Token 吞吐速率 (TPM)"
    unit="TPM"
    chart-type="line"
    :series="metricSeries"
  />
</div>

---

## 3. VaSmartRecommendation — 智能建议卡片

结合 Agent 分析结论，向用户提出优化建议，支持标注预期收益与一键采纳操作。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">AI 智能建议卡片</div>
  <VaSmartRecommendation
    title="检测到历史会话存在大量冗余工具返回"
    description="启用上下文滑动折叠与 Prompt Cache 可显著缩短下轮响应时间。"
    impact="预计降低 35% Token 成本"
    :actions="[
      { id: 'compress', label: '立即压缩会话', primary: true },
      { id: 'ignore', label: '暂不处理' }
    ]"
    @action="handleAction"
  />
</div>

---

## 4. VaBreakdownChart — 占比分解图

按条形长度展示各类目的占比分布，自动按值降序排列；`barScale` 可选按最大项或总量对齐条长，超出 `maxRows` 的尾部类目自动聚合为「其他」，行可点选。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">Agent 工具调用分布（maxRows 折叠出「其他」，行可点选）</div>
  <VaBreakdownChart
    :items="breakdownItems"
    unit="次"
    :max-rows="4"
    @select="handleBreakdownSelect"
  />
  <p style="margin: 10px 0 0; font-size: 12px; color: #94a3b8;">{{ pickedBreakdown }}</p>
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">月度模型成本分布（barScale="total" 按总量对齐条长）</div>
  <VaBreakdownChart
    :items="breakdownCostItems"
    :total="3760"
    unit="元"
    bar-scale="total"
  />
</div>

---

## 5. VaCompactBreakdown — 紧凑分解条

单行堆叠占比条 + 内联图例，一行放下迷你分布，适合嵌入卡片头部或表格行内。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">上下文窗口 Token 构成（含内联图例）</div>
  <VaCompactBreakdown :segments="compactSegments" :height="10" />
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">嵌入卡片头的迷你分布（关闭图例、6px 高）</div>
  <div style="border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 8px; padding: 12px 16px;">
    <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">上下文窗口 · 11,300 tokens / 128K</div>
    <VaCompactBreakdown :segments="compactSegments" :height="6" :legend="false" />
  </div>
</div>

---

## 6. VaCapabilityCard — 能力卡片

能力级别概念卡：`L{n}` 徽标 + 级别名 + 协议事件 / 涉及组件双列清单，用于渐进式 agent 搭建说明，`dismissible` 时可关闭。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">L1 / L2 能力卡并排展示，L2 支持关闭</div>
  <div class="demo-row">
    <div style="width: 380px;">
      <VaCapabilityCard
        :level="1"
        name="基础对话"
        description="Agent 可以理解任务，并用流式文本逐步给出回答。"
        :events="['message.start', 'message.delta', 'message.end']"
        :components="['VaThinkingLoader', 'VaStreamAnswer']"
        hint="试试：让 agent 解释一段代码的作用。"
      />
    </div>
    <div style="width: 380px;">
      <VaCapabilityCard
        :level="2"
        name="工具调用"
        title="L2 能力已启用 · 工具调用"
        description="Agent 可在回答中调用注册工具，并把结果整合进答案。"
        :events="['tool.start', 'tool.end', 'tool.error']"
        :components="['VaToolCallCard', 'VaToolCallGroup']"
        hint="试试：让 agent 读取一个本地文件并总结内容。"
        dismissible
        @dismiss="handleCapabilityDismiss"
      />
      <p v-if="capabilityDismissed" style="margin: 8px 0 0; font-size: 12px; color: #94a3b8;">
        @dismiss 已触发（生产环境中可由此隐藏整张卡）
      </p>
    </div>
  </div>
</div>

---

## 7. VaNotificationStack — 通知堆栈

通知中心列表：未读徽标与未读点、五种语义 icon（info/success/warning/danger/agent）、相对时间，支持单条与全部标记已读。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">Agent 运行通知中心（3 条未读，点击行或「全部已读」）</div>
  <VaNotificationStack
    title="通知中心"
    :notifications="notifications"
    relative-time
    :max-height="320"
    @open="handleNotificationOpen"
    @read="handleNotificationRead"
    @all-read="handleNotificationAllRead"
  />
  <p style="margin: 10px 0 0; font-size: 12px; color: #94a3b8;">{{ notificationAction }}</p>
</div>

---

## 8. VaTipsPanel — 提示面板

高亮小卡承载 1–N 条使用技巧，`dismissible` 时单条可关闭，全部关闭后展示空态文案（置空则整卡隐藏）。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">新手上手技巧（单条可关闭，逐条移除）</div>
  <VaTipsPanel
    title="新手上手技巧"
    :tips="tips"
    dismissible
    empty-label="技巧都看完啦，刷新页面可重新查看。"
    @dismiss="handleTipDismiss"
  />
  <p style="margin: 10px 0 0; font-size: 12px; color: #94a3b8;">{{ tipAction }}</p>
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">静态排查建议（不可关闭）</div>
  <VaTipsPanel title="构建失败排查建议" :tips="fixTips" />
</div>

---

## 9. VaReactionBar — 反应/表情条

emoji 快速反馈条：aria-pressed 切换态、计数徽章与按下微缩动效，默认可多选，`single` 时单选（再点取消）。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">对本条 AI 回答的多选反馈（计数实时增减）</div>
  <VaReactionBar :reactions="reactions" @toggle="handleReactionToggle" />
  <p style="margin: 10px 0 0; font-size: 12px; color: #94a3b8;">{{ reactionAction }}</p>
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">单选模式（single，👍 / 👎 二选一）</div>
  <VaReactionBar :reactions="singleReactions" single @toggle="handleSingleToggle" />
</div>

---

## 10. VaExperimentCard — 实验卡片

A/B 实验对比卡：变体并列（胜者描边 + ✓）、置信度条与结论（未达显著提示「继续观察」），running 态展示实时时长并支持结束 / 重开。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">运行中的提示词实验（点击「结束实验」切换到结论态）</div>
  <VaExperimentCard
    title="实验 #17 · 系统提示词改写"
    metric="任务完成率"
    :status="expStatus"
    :started-at="expStartedAt"
    :variants="expVariants"
    :confidence="0.96"
    @stop="handleExpStop"
    @reopen="handleExpReopen"
  />
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">已出结论的缓存实验（置信度 98% ≥ 95% 阈值）</div>
  <VaExperimentCard
    title="实验 #15 · Prompt Cache 灰度"
    metric="Token 命中率"
    status="success"
    :variants="cacheVariants"
    :confidence="0.98"
  />
</div>

---

## 11. VaAiAnswer — AI 回答与引用

带来源引用的回答卡：正文 `[n]` 标记渲染为可点击上标角标（无对应来源时原样保留），底部列出序号来源；`streaming` 时末尾带流式光标。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">基于文档检索的回答（角标与来源行可点击）</div>
  <VaAiAnswer
    :question="answerQuestion"
    :answer="answerText"
    :sources="answerSources"
    @source="handleSourcePick"
  />
  <p style="margin: 10px 0 0; font-size: 12px; color: #94a3b8;">{{ pickedSource }}</p>
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">流式回答中（末尾光标动画）</div>
  <VaAiAnswer
    question="本周构建为什么总失败？"
    :answer="streamingAnswer"
    :sources="streamingSources"
    streaming
  />
</div>
