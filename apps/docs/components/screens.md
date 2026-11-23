<script setup lang="ts">
import { ref, computed } from "vue";
import {
  VaAgentChat,
  VaComposer,
  VaAgentRun,
  VaAgentPlan,
  VaToolCallCard,
  VaContextWindow,
  VaButton,
  VaAppShell,
  VaOnboarding,
  VaSetupGuide,
  VaSettingsBilling,
  VaUsageMeter,
  VaTaskBoard,
  VaPricingPlans,
  VaAIWorkspace,
} from "@vuagent/ui";

/* ---------- 1. VaAgentChat：线上故障排查对话 ---------- */
interface ChatMsg {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt?: number;
  tools?: string[];
}
interface ChatModelOption {
  id: string;
  label: string;
  meta?: string;
  provider?: string;
}

const chatMessages = ref<ChatMsg[]>([
  {
    id: "m1",
    role: "user",
    text: "生产环境 /api/orders 查询接口今天下午开始大面积超时，帮我定位一下原因。",
    createdAt: Date.now() - 14 * 60_000,
  },
  {
    id: "m2",
    role: "agent",
    text: "收到。我先拉取该接口最近 1 小时的网关监控指标与数据库慢查询日志，再结合连接池配置做归因分析。",
    createdAt: Date.now() - 13 * 60_000,
    tools: ["gateway.metrics", "db.slow_query"],
  },
  {
    id: "m3",
    role: "user",
    text: "好，顺便确认一下是不是昨晚 v2.3.1 的发布引入的。",
    createdAt: Date.now() - 11 * 60_000,
  },
  {
    id: "m4",
    role: "agent",
    text: "对比发布前后数据：订单查询 SQL 新增了按 buyer_id 的二级索引回表，慢查询占比从 0.8% 升至 23%；同时连接池 maxOpen 从 80 被改成 40，高峰期排队直接打满超时。建议先回滚连接池配置，再补一条覆盖索引，我可以直接生成修复 PR。",
    createdAt: Date.now() - 9 * 60_000,
    tools: ["log.diff", "code.search"],
  },
  {
    id: "m5",
    role: "user",
    text: "可以，先出修复方案。",
    createdAt: Date.now() - 2 * 60_000,
  },
]);
const chatThinking = ref(true);
const composerText = ref("");

const chatModels = ref<ChatModelOption[]>([
  { id: "deepseek-v3", label: "DeepSeek V3", meta: "通用对话 · 默认", provider: "DEEPSEEK" },
  { id: "deepseek-r1", label: "DeepSeek R1", meta: "深度推理", provider: "DEEPSEEK" },
]);

function sendChat(text: string) {
  chatMessages.value.push({
    id: `m-${chatMessages.value.length + 1}`,
    role: "user",
    text,
    createdAt: Date.now(),
  });
  composerText.value = "";
}

/* ---------- 2. VaAgentRun：故障自愈运行视图 ---------- */
interface RunStep {
  id: string;
  title: string;
  detail?: string;
  status?: "pending" | "running" | "done" | "error";
  startedAt?: number;
  duration?: number;
}
interface CtxPart {
  id: string;
  label: string;
  tokens: number;
  kind: "system" | "file" | "history" | "tools";
}

const reconnectStartedAt = Date.now() - 21_000;

const runSteps = ref<RunStep[]>([
  { id: "s1", title: "采集网关与慢查询监控数据", detail: "最近 60 分钟 · 12 个指标面", status: "done", duration: 9_400 },
  { id: "s2", title: "比对 v2.3.1 发布前后的配置差异", detail: "config.yaml + 索引 DDL", status: "done", duration: 6_200 },
  { id: "s3", title: "回滚连接池 maxOpen 80 → 40 的变更", detail: "生成 kubectl patch 并灰度生效", status: "running", startedAt: reconnectStartedAt },
  { id: "s4", title: "为 order_items.buyer_id 补充覆盖索引", detail: "低峰期执行，预计 4 分钟", status: "pending" },
  { id: "s5", title: "回归压测并输出复盘报告", status: "pending" },
]);

const runContextParts = ref<CtxPart[]>([
  { id: "sys", label: "运维诊断系统提示", tokens: 1_800, kind: "system" },
  { id: "f1", label: "gateway/metrics-1830.json", tokens: 6_400, kind: "file" },
  { id: "f2", label: "db/slow-query-30m.log", tokens: 15_800, kind: "file" },
  { id: "f3", label: "release-notes-v2.3.1.md", tokens: 3_200, kind: "file" },
  { id: "hist", label: "诊断对话上下文", tokens: 21_400, kind: "history" },
  { id: "tools", label: "监控与数据库工具结果", tokens: 9_600, kind: "tools" },
]);

function removeContextPart(part: CtxPart) {
  runContextParts.value = runContextParts.value.filter((p) => p.id !== part.id);
}

function pauseRun() {
  runSteps.value = runSteps.value.map((s) =>
    s.status === "running" ? { ...s, status: "pending" as const, startedAt: undefined } : s,
  );
}

/* ---------- 3. VaAppShell：智能运营中台外壳 ---------- */
interface ShellNavItem {
  id: string;
  label: string;
  badge?: number;
  disabled?: boolean;
}

const shellNav = ref<ShellNavItem[]>([
  { id: "workbench", label: "工作台" },
  { id: "agents", label: "智能体", badge: 2 },
  { id: "tasks", label: "任务中心", badge: 5 },
  { id: "data", label: "数据看板" },
  { id: "knowledge", label: "知识库" },
  { id: "release", label: "灰度发布", disabled: true },
]);
const shellActive = ref("workbench");
const shellCollapsed = ref(false);

const shellActiveLabel = computed(
  () => shellNav.value.find((n) => n.id === shellActive.value)?.label ?? shellActive.value,
);

/* ---------- 4. VaOnboarding：新手引导 ---------- */
interface SetupStep {
  id: string;
  title: string;
  description?: string;
  status?: "done" | "skipped";
  optional?: boolean;
  actionLabel?: string;
}

const setupSteps = ref<SetupStep[]>([
  { id: "g1", title: "接入代码仓库", description: "授权 GitHub / GitLab，自动同步分支与 Issue。", status: "done" },
  { id: "g2", title: "配置模型与密钥", description: "填写 DeepSeek API Key，选择默认对话模型。", status: "done" },
  { id: "g3", title: "创建第一个智能体", description: "选择「研发助手」模板，绑定工作区目录。", actionLabel: "去创建" },
  { id: "g4", title: "接入企业 IM 通知", description: "没有 IM 也可以先跳过，稍后在设置中开启。", optional: true },
]);
const obAction = ref("尚未点击任何按钮");

function onPrimaryCta() {
  obAction.value = "已点击「创建我的第一个智能体」，此处可跳转创建向导";
}
function onSecondaryCta() {
  obAction.value = "已点击「先看看产品文档」，此处可跳转文档站";
}
function completeSetup(id: string) {
  const step = setupSteps.value.find((s) => s.id === id);
  if (!step) return;
  step.status = "done";
  obAction.value = `已完成步骤「${step.title}」`;
}
function skipSetup(id: string) {
  const step = setupSteps.value.find((s) => s.id === id);
  if (!step) return;
  step.status = "skipped";
  obAction.value = `已跳过步骤「${step.title}」`;
}
function allSetupDone() {
  obAction.value = "全部步骤处理完毕，引导完成 🎉";
}

/* ---------- 5. VaSettingsBilling：设置与账单 ---------- */
interface SettingsNavItem {
  id: string;
  label: string;
  badge?: number;
}
interface BillPlan {
  id: string;
  name: string;
  price: string;
  features: string[];
  current?: boolean;
  recommended?: boolean;
}

const settingsNav = ref<SettingsNavItem[]>([
  { id: "profile", label: "基本信息" },
  { id: "members", label: "成员管理", badge: 2 },
  { id: "billing", label: "用量与账单" },
  { id: "notify", label: "通知偏好" },
  { id: "security", label: "安全合规" },
]);
const settingsActive = ref("billing");

const billPlans = ref<BillPlan[]>([
  {
    id: "free",
    name: "免费版",
    price: "¥0",
    features: ["每月 500 次 Agent 调用", "最多 3 个智能体", "基础工具集成", "社区支持"],
    current: true,
  },
  {
    id: "pro",
    name: "专业版",
    price: "¥299 / 月",
    features: ["每月 20,000 次调用", "智能体数量不限", "私有知识库与向量检索", "审批流与操作审计", "工单优先响应"],
    recommended: true,
  },
  {
    id: "team",
    name: "企业版",
    price: "联系销售",
    features: ["私有化部署", "SLA 99.9% 保障", "SSO / LDAP 统一登录", "专属客户成功经理"],
  },
]);
const chosenPlan = ref("");

function choosePlan(plan: BillPlan) {
  chosenPlan.value = `已选择「${plan.name}」（${plan.price}），此处可发起升级确认`;
}
function manageUsage() {
  chosenPlan.value = "已点击「管理用量」入口，可跳转套餐升级页";
}

const usageSegments = [
  { label: "对话生成", used: 168_000, color: "#6366f1" },
  { label: "工具调用", used: 64_000, color: "#22c55e" },
  { label: "知识索引", used: 38_000, color: "#f59e0b" },
];

/* ---------- 6. VaTaskBoard：客服系统迭代看板 ---------- */
interface BoardCol {
  id: string;
  title: string;
  hint?: string;
}
interface BoardTaskItem {
  id: string;
  columnId: string;
  title: string;
  assignee?: string;
  priority?: "low" | "medium" | "high";
  meta?: string;
}

const boardColumns = ref<BoardCol[]>([
  { id: "backlog", title: "待处理" },
  { id: "doing", title: "进行中" },
  { id: "review", title: "待评审" },
  { id: "done", title: "已完成" },
]);

const boardTasks = ref<BoardTaskItem[]>([
  { id: "t-3001", columnId: "backlog", title: "接入企业微信渠道回调", assignee: "王晓峰", priority: "medium", meta: "截止 11-28" },
  { id: "t-3002", columnId: "backlog", title: "FAQ 知识库支持拼音检索", assignee: "陈璐", priority: "low" },
  { id: "t-3003", columnId: "backlog", title: "生成压测报告模板重构", assignee: "林远", priority: "high", meta: "阻塞发版" },
  { id: "t-2041", columnId: "doing", title: "修复多轮对话上下文丢失", assignee: "周予安", priority: "high", meta: "预计 2 天" },
  { id: "t-2042", columnId: "doing", title: "Webhook 重试改为指数退避", assignee: "王晓峰", priority: "medium", meta: "进度 60%" },
  { id: "t-1055", columnId: "review", title: "坐席工作台暗色主题适配", assignee: "陈璐", priority: "medium", meta: "待 2 人评审" },
  { id: "t-1056", columnId: "review", title: "意图识别模型灰度切流", assignee: "林远", priority: "high", meta: "灰度 20%" },
  { id: "t-0901", columnId: "done", title: "会话转人工规则引擎上线", assignee: "周予安", priority: "high", meta: "耗时 3 天" },
  { id: "t-0902", columnId: "done", title: "客服满意度周报自动化", assignee: "陈璐", priority: "low", meta: "已发布" },
]);

const boardSelected = ref("t-2041");
const boardOpened = ref("");

function openTask(task: BoardTaskItem) {
  boardOpened.value = task.title;
}

/* ---------- 7. VaPricingPlans + VaAIWorkspace：定价方案与 AI 工作区 ---------- */
interface PriceTier {
  id: string;
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  current?: boolean;
  recommended?: boolean;
  ctaLabel?: string;
}
interface WsFile {
  id: string;
  name: string;
  status?: "modified" | "added" | "deleted" | "untracked";
}

const pricingTiers = ref<PriceTier[]>([
  {
    id: "starter",
    name: "入门版",
    price: "¥0",
    period: "按月",
    description: "个人开发者与试用评估",
    features: ["1 个工作区", "每月 200 次 AI 生成", "公开项目协作", "社区支持"],
    ctaLabel: "免费开始",
  },
  {
    id: "pro",
    name: "团队版",
    price: "¥99",
    period: "按月 / 席位",
    description: "小团队日常协作首选",
    features: ["10 个工作区", "每月 5,000 次 AI 生成", "私有知识库", "成员角色与权限", "集成飞书 / 钉钉通知"],
    recommended: true,
    ctaLabel: "升级到团队版",
  },
  {
    id: "ent",
    name: "企业版",
    price: "¥899",
    period: "按月 / 席位",
    description: "规模化组织与合规场景",
    features: ["工作区数量不限", "每月 50,000 次 AI 生成", "SSO 单点登录与审计日志", "私有化部署选项", "专属技术支持"],
    ctaLabel: "联系销售",
  },
]);
const pickedTier = ref("");

function chooseTier(tier: PriceTier) {
  pickedTier.value = `已选择「${tier.name}」· ${tier.price}，此处可发起购买流程`;
}

const wsFiles = ref<WsFile[]>([
  { id: "f1", name: "src/agent/scheduler.ts", status: "modified" },
  { id: "f2", name: "src/agent/tools/webhook.ts", status: "added" },
  { id: "f3", name: "src/pages/dashboard.vue", status: "modified" },
  { id: "f4", name: "src/legacy/order-sync.ts", status: "deleted" },
]);
const wsSelected = ref("f1");

const WS_STATUS_TEXT: Record<string, string> = {
  modified: "已修改",
  added: "新增",
  deleted: "已删除",
  untracked: "未跟踪",
};

const wsCurrent = computed(() => wsFiles.value.find((f) => f.id === wsSelected.value));

const wsPreviews: Record<string, string> = {
  f1: `// 调度器：任务排队与重试上限调整
- const maxRetry = 3;
+ const maxRetry = 5;
  if (attempt > maxRetry) {
    return fail(task, { reason: "retry_exhausted" });
  }`,
  f2: `// 新增：Webhook 通知工具
+ export async function notifyWebhook(url: string, payload: Record<string, unknown>) {
+   const res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
+   if (!res.ok) throw new Error("webhook_failed: " + res.status);
+ }`,
  f3: `<!-- 看板页新增「本周新增会话」指标卡 -->
+ <VaKpiChart label="本周新增会话" :value="1284" :delta="0.18" :series="sessionSeries" />`,
  f4: `// 已删除：旧的订单同步轮询实现（已由事件订阅取代）`,
};
</script>

# Screens 与工作区块

> 开箱即用的全屏级界面与工作区块：对话页、运行页、应用外壳、引导页、设置账单，以及可直接嵌入业务系统的定价卡与 AI 工作区。按真实产品形态组装，接上数据即可上线。

---

## 1. VaAgentChat — 完整对话界面

对话页骨架：消息流（用户 / agent 气泡 + 工具调用 chips）、思考态三点动效与贴底自动滚动。通过 `#composer` 插槽接入 `VaComposer`，即可得到一个可直接输入、发送的完整对话产品页。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">Agent 正在生成修复方案（思考态三点 + 工具 chips，底部输入框可直接发送）</div>
  <VaAgentChat
    title="运维诊断助手 · order-service 生产群"
    :messages="chatMessages"
    :thinking="chatThinking"
    thinking-label="正在生成修复方案…"
    :max-height="420"
  >
    <template #composer>
      <VaComposer
        v-model:text="composerText"
        placeholder="描述你的问题，或直接粘贴告警日志…"
        attachable
        :models="chatModels"
        :max-height="160"
        @send="sendChat"
      />
    </template>
  </VaAgentChat>
</div>

---

## 2. VaAgentRun — Agent 运行视图

运行页骨架：头部（状态徽章 + 耗时 + 操作区插槽）+ 三栏布局（计划 | 执行流 | 上下文），窄屏自动降栏。三栏内容全部由插槽注入，可自由组合 Agent-Ops 组件，拼出真实的运行控制台。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">三栏运行视图：计划 · 执行流 · 上下文（工具卡可展开，文件格子可移除）</div>
  <VaAgentRun
    title="订单超时故障自愈"
    status="running"
    status-label="正在执行第 3/5 步 · 回滚连接池配置"
    :duration="186_000"
  >
    <template #actions>
      <VaButton variant="secondary" size="sm" @click="pauseRun">暂停执行</VaButton>
      <VaButton variant="ghost" size="sm">查看完整日志</VaButton>
    </template>
    <template #plan>
      <VaAgentPlan title="自愈执行计划" :steps="runSteps" />
    </template>
    <VaToolCallCard
      name="db.slow_query"
      summary="拉取 order 库最近 30 分钟慢查询 Top 20"
      status="success"
      :args="{ db: 'orders', window: '30m', top: 20 }"
      :result="{ matched: 20, worst: 'SELECT * FROM order_items WHERE buyer_id = ? 回表扫描', avgMs: 1840 }"
      :duration="940"
      default-open
    />
    <VaToolCallCard
      name="k8s.patch_deployment"
      summary="回滚连接池 maxOpen 40 → 80 并滚动重启"
      status="running"
      :args="{ namespace: 'prod', deployment: 'order-service', patch: { maxOpen: 80 } }"
      :started-at="reconnectStartedAt"
    />
    <template #aside>
      <VaContextWindow
        :parts="runContextParts"
        :capacity="128_000"
        removable
        @remove="removeContextPart"
      />
    </template>
  </VaAgentRun>
</div>

---

## 3. VaAppShell — 应用外壳布局

应用外壳：品牌侧栏 + 导航（徽标 / 禁用项）+ 顶栏与主区插槽，导航项哨兵受控，侧栏支持折叠成 64px 图标列，窄屏自动抽屉化（scrim + 汉堡按钮）。适合作为整个业务系统的最外层容器。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">当前导航：{{ shellActiveLabel }}{{ shellCollapsed ? " · 侧栏已折叠" : "" }}（点击左侧导航或折叠按钮体验联动）</div>
  <VaAppShell
    brand="云枢 · 智能运营中台"
    :nav="shellNav"
    v-model:active="shellActive"
    v-model:collapsed="shellCollapsed"
    collapsible
  >
    <template #topbar>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 13px;">
        <span style="color: var(--vp-c-text-2);">运营中台 / {{ shellActiveLabel }}</span>
        <span style="display: flex; align-items: center; gap: 10px;">
          <input disabled placeholder="搜索智能体、任务、文档…  ⌘K" style="width: 220px; padding: 5px 10px; font-size: 12px; border: 1px solid var(--va-color-border, #d4d4d8); border-radius: 8px; background: transparent; color: inherit;" />
          <span style="width: 26px; height: 26px; border-radius: 50%; background: #4f46e5; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px;">曾</span>
        </span>
      </div>
    </template>
    <template #sidebar-foot>
      <div style="font-size: 12px; color: var(--vp-c-text-2); display: flex; align-items: center; gap: 8px;">
        <span style="width: 24px; height: 24px; border-radius: 50%; background: #0ea5e9; color: #fff; display: inline-flex; align-items: center; justify-content: center;">曾</span>
        <span>曾雨薇 · 运营管理员</span>
      </div>
    </template>
    <div style="padding: 4px 2px;">
      <h3 style="margin: 0 0 4px;">{{ shellActiveLabel }}</h3>
      <p style="margin: 0 0 16px; font-size: 13px; color: var(--vp-c-text-2);">主区内容随导航联动，此处的统计卡为示例数据。</p>
      <div style="display: flex; flex-wrap: wrap; gap: 12px;">
        <div style="flex: 1; min-width: 150px; border: 1px solid var(--va-color-border, #e4e4e7); border-radius: 10px; padding: 12px 14px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: var(--vp-c-text-2);">今日运行任务</p>
          <strong style="font-size: 22px;">1,284</strong>
        </div>
        <div style="flex: 1; min-width: 150px; border: 1px solid var(--va-color-border, #e4e4e7); border-radius: 10px; padding: 12px 14px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: var(--vp-c-text-2);">任务成功率</p>
          <strong style="font-size: 22px;">96.4%</strong>
        </div>
        <div style="flex: 1; min-width: 150px; border: 1px solid var(--va-color-border, #e4e4e7); border-radius: 10px; padding: 12px 14px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: var(--vp-c-text-2);">平均运行耗时</p>
          <strong style="font-size: 22px;">42s</strong>
        </div>
      </div>
    </div>
  </VaAppShell>
</div>

---

## 4. VaOnboarding — 新手引导

上手引导页：居中 hero（品牌徽标 + 大标题 + 主 / 次 CTA）+ 步骤区插槽。步骤区放 `VaSetupGuide` 接入清单即可，用户逐步完成后 CTA 侧的引导流程一目了然。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">当前状态：{{ obAction }}（点击主 / 次 CTA，或在下方逐步完成引导步骤）</div>
  <VaOnboarding
    brand="Vuagent"
    title="欢迎使用 Vuagent 智能工作台"
    subtitle="3 分钟完成接入，让 AI 助手接管团队日常研发流程。"
    cta-label="创建我的第一个智能体"
    secondary-cta-label="先看看产品文档"
    @cta="onPrimaryCta"
    @secondary-cta="onSecondaryCta"
  >
    <template #hero-foot>
      <p style="margin: 0; font-size: 12px; color: var(--vp-c-text-2);">已有 2,300+ 研发团队在 Vuagent 上交付智能体应用</p>
    </template>
    <VaSetupGuide
      title="接入准备"
      finish-label="全部就绪，开始体验吧 🎉"
      :steps="setupSteps"
      @complete="completeSetup"
      @skip="skipSetup"
      @all-done="allSetupDone"
    />
  </VaOnboarding>
</div>

---

## 5. VaSettingsBilling — 设置与账单

设置 / 账单页：左侧设置导航（哨兵受控）+ 用量插槽 + 套餐卡网格。套餐卡自带「当前 / 推荐」徽标与特性清单，点击即回调 `choosePlan`，升级降级流程一次成型。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">套餐操作：{{ chosenPlan || "点击「切换到此套餐」或用量条的「管理」入口试试" }}</div>
  <VaSettingsBilling
    title="组织设置"
    :nav="settingsNav"
    v-model:active="settingsActive"
    :plans="billPlans"
    @choose-plan="choosePlan"
  >
    <template #usage>
      <div style="border: 1px solid var(--va-color-border, #e4e4e7); border-radius: 10px; padding: 14px 16px; margin-bottom: 18px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
          <strong style="font-size: 14px;">本月 Agent 用量</strong>
          <span style="font-size: 12px; color: var(--vp-c-text-2);">当前套餐：免费版</span>
        </div>
        <VaUsageMeter
          :segments="usageSegments"
          :limit="500_000"
          unit="tokens"
          period="本月 · 12 月 1 日重置"
          @manage="manageUsage"
        />
      </div>
    </template>
  </VaSettingsBilling>
</div>

---

## 6. VaTaskBoard — 任务看板

任务看板：列 × 卡片矩阵，卡片自带优先级色点、负责人首字母与角标 meta，列头计数自动统计，点击卡片选中并回调 `open`，适合作为项目管理或任务分发场景的核心区块。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">看板交互：{{ boardOpened ? `已打开「${boardOpened}」` : "点击任意卡片试试（列计数自动、优先级色点、负责人首字母）" }}</div>
  <VaTaskBoard
    :columns="boardColumns"
    :tasks="boardTasks"
    v-model:selected="boardSelected"
    @open="openTask"
  />
</div>

---

## 7. VaPricingPlans + VaAIWorkspace — 定价方案与 AI 工作区

Blocks 两件套：`VaPricingPlans` 定价卡组（推荐 / 当前态 + 特性清单 + CTA），适合 marketing 页与升级弹窗；`VaAIWorkspace` 文件栏 + 预览区双栏工作块（M / A / D 徽标、选中联动、作用域插槽传当前文件），适合代码评审与变更预览场景。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">定价方案：{{ pickedTier || "点击卡片底部按钮试试（推荐档高亮）" }}</div>
  <VaPricingPlans title="为团队选择合适的方案" :tiers="pricingTiers" @choose="chooseTier" />
</div>

<div class="demo-preview vp-raw">
  <div class="demo-title">AI 工作区：当前预览 {{ wsCurrent ? `「${wsCurrent.name}」（${WS_STATUS_TEXT[wsCurrent.status ?? "modified"]}）` : "（点击左侧文件试试）" }}</div>
  <VaAIWorkspace
    files-label="本次变更 · 4 个文件"
    :files="wsFiles"
    v-model:selected="wsSelected"
  >
    <template #default="{ file }">
      <div v-if="file">
        <p style="margin: 0 0 10px; font-size: 12px; color: var(--vp-c-text-2);">
          <span style="display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--va-color-surface-soft, #f4f4f5); border: 1px solid var(--va-color-border, #e4e4e7); margin-right: 8px;">{{ WS_STATUS_TEXT[file.status ?? "modified"] }}</span>
          {{ file.name }}
        </p>
        <pre style="margin: 0; font-size: 12px; line-height: 1.7; background: var(--va-color-surface-soft, #f8fafc); border: 1px solid var(--va-color-border, #e4e4e7); border-radius: 8px; padding: 12px 14px; overflow: auto; color: inherit; white-space: pre-wrap;">{{ wsPreviews[file.id] ?? "" }}</pre>
      </div>
    </template>
  </VaAIWorkspace>
</div>
