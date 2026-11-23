<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VaStepperForm,
  VaDateRangePicker,
  VaPromptLibrary,
  VaSetupGuide,
  VaIntegrationPicker,
  VaIntegrationSettings,
} from "@vuagent/ui";

/* ========== 1. VaStepperForm：创建部署项目 ========== */
const stepperSteps = [
  { id: "source", title: "选择代码源", description: "绑定 Git 仓库" },
  { id: "config", title: "构建配置", description: "分支与触发方式" },
  { id: "confirm", title: "确认创建", description: "核对信息并提交" },
];
const currentStep = ref(0);
const selectedRepoId = ref("");
const branch = ref("main");
const trigger = ref("push");
const submitting = ref(false);
const submitted = ref(false);
const stepperEvent = ref("等待操作");

const repos = [
  { id: "r1", name: "vuagent/web-console", desc: "主控制台前端 · TypeScript" },
  { id: "r2", name: "vuagent/gateway", desc: "接入网关服务 · Go" },
  { id: "r3", name: "vuagent/docs-site", desc: "文档与组件示例 · Markdown" },
];
const selectedRepo = computed(() => repos.find((r) => r.id === selectedRepoId.value));
const triggerText = computed(
  () => ({ push: "推送时自动构建", manual: "手动触发", cron: "定时构建（每日 02:00）" })[trigger.value] ?? ""
);

const stepperNextDisabled = computed(() => {
  if (currentStep.value === 0) return !selectedRepoId.value;
  if (currentStep.value === 1) return !branch.value.trim();
  return false;
});
const stepperTitle = computed(() => {
  if (submitted.value) return "✅ 演示状态：项目「web-console 生产环境」创建成功（@submit 已触发）";
  if (submitting.value) return "⏳ 演示状态：正在提交创建请求…";
  return `📍 演示状态：第 ${currentStep.value + 1} 步 · ${stepperSteps[currentStep.value].title} — ${stepperEvent.value}`;
});

function onStepperNext(prev: number) {
  stepperEvent.value = `第 ${prev + 1} 步校验通过，进入下一步`;
}
function onStepperBack(prev: number) {
  stepperEvent.value = `从第 ${prev + 2} 步返回上一步`;
}
function onStepperSubmit() {
  submitting.value = true;
  submitted.value = false;
  // 模拟一次创建请求（单次延时，非轮询）
  setTimeout(() => {
    submitting.value = false;
    submitted.value = true;
  }, 1200);
}

/* ========== 2. VaDateRangePicker：报表统计周期 ========== */
const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const today = new Date();
const rangeStart = ref(startOfDay(new Date(today.getTime() - 6 * DAY)));
const rangeEnd = ref(startOfDay(today));
const rangePresets = [
  { id: "biweekly", label: "双周报", from: -13, to: 0 },
  { id: "quarter", label: "季度报表", from: -89, to: 0 },
];
const rangeChanged = ref(false);

function fmtTs(ts: number) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
const rangeLabel = computed(
  () => `${fmtTs(rangeStart.value)} ~ ${fmtTs(rangeEnd.value)}，共 ${Math.round((rangeEnd.value - rangeStart.value) / DAY) + 1} 天`
);
const dateTitle = computed(() =>
  rangeChanged.value
    ? `📅 演示状态：已确定新统计周期 ${rangeLabel.value}（@change 已触发）`
    : `📅 演示状态：当前统计周期 ${rangeLabel.value} — 在日历上点两次即可重新选择区间`
);
function onRangeChange(range: { start: number; end: number }) {
  rangeStart.value = range.start;
  rangeEnd.value = range.end;
  rangeChanged.value = true;
}

/* ========== 3. VaPromptLibrary：团队提示词库 ========== */
const prompts = ref([
  {
    id: "p1",
    title: "接口代码审查",
    body: "请以资深后端视角审查以下接口定义：关注参数校验、错误码语义、幂等性与向后兼容，输出一份按严重度排序的修改建议清单。",
    category: "代码审查",
    tags: ["API", "后端"],
  },
  {
    id: "p2",
    title: "线上缺陷定位",
    body: "给定报错堆栈与最近一次发布记录，按可能性从高到低列出排查方向，并为每一步给出可直接执行的验证命令。",
    category: "缺陷排查",
    tags: ["排障", "发布"],
  },
  {
    id: "p3",
    title: "迭代周报生成",
    body: "根据本周合并的 PR 与禅道任务，按「进展 / 风险 / 下周计划」三段生成周报，语气克制、数据准确、不堆砌形容词。",
    category: "文档",
    tags: ["周报", "协作"],
  },
  {
    id: "p4",
    title: "单测用例补齐",
    body: "为指定函数补齐边界条件测试用例：空输入、极值、并发与异常路径，风格与仓库现有测试保持一致。",
    category: "测试",
    tags: ["单测", "质量"],
  },
  {
    id: "p5",
    title: "数据库迁移评审",
    body: "审查以下 DDL 变更脚本：检查锁表风险、回滚方案与索引合理性，逐条标注需要 DBA 复核的改动。",
    category: "代码审查",
    tags: ["数据库", "风险"],
  },
]);
const promptQuery = ref("");
const usedPrompt = ref<{ id: string; title: string } | null>(null);
const promptTitle = computed(() => {
  const q = promptQuery.value.trim();
  const scope = q ? `搜索词「${q}」生效中` : `共 ${prompts.value.length} 条团队提示词`;
  return usedPrompt.value
    ? `📤 演示状态：已将《${usedPrompt.value.title}》插入编辑器（@use 已触发） · ${scope}`
    : `📚 演示状态：${scope} — 点击卡片右下角「使用」查看回调`;
});
function onUsePrompt(p: { id: string; title: string }) {
  usedPrompt.value = p;
}

/* ========== 4. VaSetupGuide：接入准备清单 ========== */
const setupSteps = ref([
  { id: "install", title: "安装 vuagent CLI", description: "执行 npm i -g @vuagent/cli 并完成账号登录", actionLabel: "我已安装完成" },
  { id: "apikey", title: "创建 API Key", description: "在控制台「密钥管理」中新建一条项目级密钥" },
  { id: "webhook", title: "配置 Webhook 回调", description: "用于接收任务状态推送，可稍后再配", optional: true },
  { id: "invite", title: "邀请团队成员", description: "邀请协作成员加入当前工作区", optional: true },
]);
const setupFinished = ref(false);
const setupDoneCount = computed(() => setupSteps.value.filter((s) => s.status === "done").length);
const setupSkippedCount = computed(() => setupSteps.value.filter((s) => s.status === "skipped").length);
const setupTitle = computed(() => {
  if (setupFinished.value) return "🎉 演示状态：全部就绪，@allDone 已触发，可以开始接入 SDK";
  return `✅ 演示状态：已完成 ${setupDoneCount.value} / ${setupSteps.value.length} 项，跳过 ${setupSkippedCount.value} 项 — 点击条目右侧按钮推进`;
});
function onStepComplete(id: string) {
  const step = setupSteps.value.find((s) => s.id === id);
  if (step) step.status = "done";
}
function onStepSkip(id: string) {
  const step = setupSteps.value.find((s) => s.id === id);
  if (step) step.status = "skipped";
}
function onAllDone() {
  setupFinished.value = true;
}

/* ========== 5. 集成两件套：工作台集成中心 ========== */
const services = ref([
  { id: "github", name: "GitHub 仓库", description: "同步仓库事件并自动触发任务", connected: true },
  { id: "feishu", name: "飞书群通知", description: "任务完成与审批请求推送到群机器人", connected: false },
  { id: "sentry", name: "Sentry 异常监控", description: "线上异常自动建单跟进", connected: false },
]);
const selectedId = ref("github");
const serviceState = ref<Record<string, { enabled: boolean; values: Record<string, string> }>>({
  github: { enabled: true, values: { token: "ghp_9f2Xc8（已脱敏）", org: "acme-fe" } },
  feishu: { enabled: false, values: { webhook: "", secret: "" } },
  sentry: { enabled: false, values: { dsn: "", env: "production" } },
});
const fieldsByService: Record<string, Array<{ id: string; label: string; placeholder?: string; secret?: boolean; required?: boolean }>> = {
  github: [
    { id: "token", label: "访问令牌（Personal Access Token）", placeholder: "ghp_ 开头", secret: true, required: true },
    { id: "org", label: "默认组织", placeholder: "例如 acme-fe" },
  ],
  feishu: [
    { id: "webhook", label: "群机器人 Webhook 地址", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…", required: true },
    { id: "secret", label: "签名校验密钥", placeholder: "留空表示不启用签名校验", secret: true },
  ],
  sentry: [
    { id: "dsn", label: "项目 DSN", placeholder: "https://xxx@sentry.example.com/12", secret: true, required: true },
    { id: "env", label: "环境标识", placeholder: "production / staging" },
  ],
};
const currentService = computed(() => services.value.find((s) => s.id === selectedId.value));
const settingsName = computed(() => currentService.value?.name ?? "");
const settingsDescription = computed(() => currentService.value?.description ?? "");
const settingsFields = computed(() => fieldsByService[selectedId.value]);
const settingsEnabled = computed({
  get: () => serviceState.value[selectedId.value].enabled,
  set: (v: boolean) => {
    serviceState.value[selectedId.value].enabled = v;
  },
});
const settingsValues = computed({
  get: () => serviceState.value[selectedId.value].values,
  set: (v: Record<string, string>) => {
    serviceState.value[selectedId.value].values = v;
  },
});
const saving = ref(false);
const savedLabel = ref("");
const lastMsg = ref("点击卡片可切换连接并进入对应配置面板");
const connectedCount = computed(() => services.value.filter((s) => s.connected).length);
const integrationTitle = computed(() => {
  const base = `🔌 演示状态：已连接 ${connectedCount.value} / ${services.value.length} 个服务 · 正在编辑「${settingsName.value}」`;
  const tip = savedLabel.value ? savedLabel.value : lastMsg.value;
  return `${base} — ${tip}`;
});

function onPickerSelect(item: { id: string }) {
  selectedId.value = item.id;
}
function onPickerToggle(item: { id: string; name: string; connected?: boolean }) {
  const target = services.value.find((s) => s.id === item.id);
  if (target) target.connected = !target.connected;
  lastMsg.value = `${target?.connected ? "已连接" : "已断开"}「${item.name}」`;
}
function onSaveSettings(payload: { enabled: boolean; values: Record<string, string> }) {
  saving.value = true;
  savedLabel.value = "";
  const serviceId = selectedId.value;
  // 模拟一次保存请求（单次延时，非轮询）
  setTimeout(() => {
    saving.value = false;
    savedLabel.value = payload.enabled ? "配置已保存，连接生效" : "配置已保存（集成处于停用状态）";
    if (payload.enabled) {
      const target = services.value.find((s) => s.id === serviceId);
      if (target) target.connected = true;
    }
  }, 900);
}
function onDisconnectSettings() {
  const serviceId = selectedId.value;
  serviceState.value[serviceId].enabled = false;
  const target = services.value.find((s) => s.id === serviceId);
  if (target) target.connected = false;
  savedLabel.value = "";
  lastMsg.value = `已断开「${target?.name ?? ""}」的连接`;
}
</script>

# 表单与集成组件

> 表单与集成组件覆盖任务创建与配置的两类高频场景：分步表单承载多阶段向导式录入，日期区间、提示词库与配置引导负责把离散的输入收敛成结构化数据，集成两件套则把第三方服务的连接与参数配置收纳进统一的交互范式。

---

## 1. VaStepperForm — 分步表单

创建部署项目这类流程需要在多个阶段分批收集信息。VaStepperForm 提供步骤条外壳与每一步的具名插槽（`#step-{id}`），由宿主通过 `nextDisabled` 承接每步校验，最后一步自动转为提交按钮，流程事件（`@next` / `@back` / `@submit`）全部回调给业务侧。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">{{ stepperTitle }}</div>
  <VaStepperForm
    :steps="stepperSteps"
    v-model:step="currentStep"
    :next-disabled="stepperNextDisabled"
    :submitting="submitting"
    finish-label="创建项目"
    @next="onStepperNext"
    @back="onStepperBack"
    @submit="onStepperSubmit"
  >
    <template #step-source>
      <div style="display: grid; gap: 8px;">
        <button
          v-for="r in repos"
          :key="r.id"
          type="button"
          @click="selectedRepoId = r.id"
          :style="{
            textAlign: 'left',
            padding: '10px 14px',
            borderRadius: '8px',
            border: '1px solid',
            borderColor: selectedRepoId === r.id ? '#6366f1' : '#d4d4d8',
            background: selectedRepoId === r.id ? '#eef2ff' : '#fff',
            cursor: 'pointer',
          }"
        >
          <strong style="font-size: 13px;">{{ r.name }}</strong>
          <span style="display: block; font-size: 12px; color: #71717a; margin-top: 2px;">{{ r.desc }}</span>
        </button>
      </div>
      <p v-if="!selectedRepoId" style="font-size: 12px; color: #a1a1aa; margin-top: 8px;">请选择一个代码仓库后继续（未选择时「下一步」保持禁用）</p>
    </template>
    <template #step-config>
      <label style="display: block; font-size: 13px; color: #52525b; margin: 4px 0;">构建分支</label>
      <input
        v-model="branch"
        placeholder="例如 main 或 release/2.x"
        style="width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #d4d4d8; border-radius: 8px; font-size: 13px;"
      />
      <label style="display: block; font-size: 13px; color: #52525b; margin: 12px 0 4px;">触发方式</label>
      <select v-model="trigger" style="width: 100%; padding: 8px 12px; border: 1px solid #d4d4d8; border-radius: 8px; font-size: 13px;">
        <option value="push">推送时自动构建</option>
        <option value="manual">手动触发</option>
        <option value="cron">定时构建（每日 02:00）</option>
      </select>
    </template>
    <template #step-confirm>
      <ul style="font-size: 13px; line-height: 2; color: #3f3f46; padding-left: 4px; margin: 4px 0;">
        <li>代码仓库：<strong>{{ selectedRepo?.name ?? "未选择" }}</strong></li>
        <li>构建分支：<strong>{{ branch || "未填写" }}</strong></li>
        <li>触发方式：<strong>{{ triggerText }}</strong></li>
        <li>目标环境：生产（prod-cluster-01）</li>
      </ul>
      <p style="font-size: 12px; color: #a1a1aa;">点击「创建项目」后进入提交态，按钮将显示「提交中…」。</p>
    </template>
  </VaStepperForm>
</div>

---

## 2. VaDateRangePicker — 日期区间选择

报表与账单场景几乎都要选一个统计周期。VaDateRangePicker 用零依赖的双月日历实现「两次点击」选区间：反向选择自动交换、悬停实时预览范围、预设一键套用，选定完整区间后通过 `@change` 回调给宿主，值约定为当日 00:00 的本地时区时间戳。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">{{ dateTitle }}</div>
  <VaDateRangePicker
    v-model:start="rangeStart"
    v-model:end="rangeEnd"
    :presets="rangePresets"
    placeholder="选择转化漏斗的统计周期"
  />
</div>

---

## 3. VaPromptLibrary — 提示词库

团队沉淀的高质量提示词需要可搜索、可复用。VaPromptLibrary 按分类 tab + 卡片网格组织提示词资产，标题/正文/标签全文匹配搜索（`query` 可受控），点击「使用」通过 `@use` 把完整条目交给宿主插入编辑器。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">{{ promptTitle }}</div>
  <VaPromptLibrary
    :prompts="prompts"
    v-model:query="promptQuery"
    placeholder="搜索标题、正文或标签，如「审查」「周报」"
    empty-label="没有匹配的提示词，换个关键词试试"
    @use="onUsePrompt"
  />
</div>

---

## 4. VaSetupGuide — 配置引导

新用户接入 SDK 前常有 3-5 项前置准备。VaSetupGuide 以清单逐项推进：完成态由宿主维护（`status: done | skipped`），可选项支持跳过，带进度计数与收尾文案，全部处理完毕触发一次 `@allDone`。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">{{ setupTitle }}</div>
  <VaSetupGuide
    :steps="setupSteps"
    title="接入准备清单"
    finish-label="🎉 全部就绪，可以开始接入 SDK 了"
    @complete="onStepComplete"
    @skip="onStepSkip"
    @all-done="onAllDone"
  />
</div>

---

## 5. VaIntegrationPicker + VaIntegrationSettings — 第三方集成

接入第三方服务是「先选服务、再配参数」的两段流程：VaIntegrationPicker 以卡片网格展示服务列表与已连接态，点击卡片切换连接；VaIntegrationSettings 承接选中服务的配置面板，总开关与表单值均由宿主受控，保存 / 断开事件回传业务侧。两个组件组合即可构成完整的集成中心。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">{{ integrationTitle }}</div>
  <div style="display: grid; gap: 16px;">
    <VaIntegrationPicker
      :items="services"
      :min-card-width="200"
      @select="onPickerSelect"
      @toggle="onPickerToggle"
    />
    <VaIntegrationSettings
      :name="settingsName"
      :description="settingsDescription"
      v-model:enabled="settingsEnabled"
      v-model:values="settingsValues"
      :fields="settingsFields"
      :saving="saving"
      :saved-label="savedLabel"
      @save="onSaveSettings"
      @disconnect="onDisconnectSettings"
    />
  </div>
</div>
