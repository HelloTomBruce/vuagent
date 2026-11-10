<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VaChangeSummary,
  VaCombobox,
  VaDateRangePicker,
  VaFilterMenu,
  VaIntegrationPicker,
  VaIntegrationSettings,
  VaNotificationStack,
  VaOtpInput,
  VaProfileMenu,
  VaProgressTracker,
  VaPromptLibrary,
  VaReactionBar,
  VaSetupGuide,
  VaSmartRecommendation,
  VaStepperForm,
  VaTipsPanel,
  VaToaster,
  vaToaster,
} from "@vuagent/ui";
import type {
  IntegrationItem,
  NotificationItem,
  ReactionItem,
  SetupStep,
  SummaryFile,
} from "@vuagent/ui";
import { addDays, dayStart } from "@vuagent/ui";

/* ================= Combobox：模型选择（可创建） ================= */
const model = ref("claude-sonnet");
const models = [
  { value: "claude-sonnet", label: "Claude Sonnet", hint: "推荐" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "glm-5", label: "GLM-5", hint: "国产" },
  { value: "local-qwen", label: "本地 Qwen（已停用）", disabled: true },
];

/* ================= FilterMenu：任务过滤 ================= */
const filterValue = ref({ kind: ["review"], env: "prod" });

/* ================= OTP：验证码 ================= */
const otp = ref("");
function onOtpComplete(v: string) {
  vaToaster.add({ title: "验证码已填满", description: v, kind: "success" });
}

/* ================= StepperForm：创建 agent 向导 ================= */
const step = ref(0);
const wizardName = ref("");
const wizardOk = computed(() => (step.value === 0 ? !!wizardName.value.trim() : true));
const submitting = ref(false);
function onSubmit() {
  submitting.value = true;
  window.setTimeout(() => {
    submitting.value = false;
    vaToaster.add({ title: "agent 已创建", description: wizardName.value, kind: "success" });
    step.value = 0;
    wizardName.value = "";
  }, 1000);
}

/* ================= SetupGuide ================= */
const setupSteps = ref<SetupStep[]>([
  { id: "cli", title: "安装 CLI", description: "npm i -g vuagent-cli", status: "done" },
  { id: "key", title: "配置 API Key", description: "在下方集成面板填入", status: "done" },
  { id: "repo", title: "连接第一个仓库", optional: true },
]);
function completeStep(id: string) {
  setupSteps.value = setupSteps.value.map((s) => (s.id === id ? { ...s, status: "done" } : s));
}

/* ================= DateRangePicker ================= */
const rangeStart = ref(addDays(dayStart(Date.now()), -6));
const rangeEnd = ref(dayStart(Date.now()));

/* ================= Integration ================= */
const integrations = ref<IntegrationItem[]>([
  { id: "gh", name: "GitHub", description: "仓库、Issue 与 PR 联动", connected: true },
  { id: "slack", name: "Slack", description: "任务完成通知到频道" },
  { id: "feishu", name: "飞书", description: "审批卡片直达" },
  { id: "sentry", name: "Sentry", description: "线上错误自动排查" },
]);
function toggleIntegration(item: IntegrationItem) {
  integrations.value = integrations.value.map((i) =>
    i.id === item.id ? { ...i, connected: !i.connected } : i,
  );
  vaToaster.add({ title: `${item.name} ${item.connected ? "已断开" : "已连接"}`, kind: item.connected ? "info" : "success" });
}
const ghEnabled = ref(true);
const ghValues = ref({ token: "" });
const ghSaving = ref(false);
const ghSaved = ref("");
function saveGh() {
  ghSaving.value = true;
  window.setTimeout(() => {
    ghSaving.value = false;
    ghSaved.value = "已保存 ✓";
    window.setTimeout(() => (ghSaved.value = ""), 2000);
  }, 800);
}

/* ================= 通知 + Profile ================= */
const notifications = ref<NotificationItem[]>([
  { id: "n1", title: "PR #128 审查完成", body: "agent 发现 2 处竞态，建议加锁", kind: "agent", unread: true, createdAt: Date.now() - 3 * 60_000 },
  { id: "n2", title: "构建失败", body: "main 分支 vitest 挂了 1 个用例", kind: "danger", unread: true, createdAt: Date.now() - 40 * 60_000 },
  { id: "n3", title: "额度已重置", kind: "success", createdAt: Date.now() - 5 * 3_600_000 },
]);

/* ================= 反馈 ================= */
const tips = ref([
  { id: "t1", title: "试试 ⌘K", body: "随时唤起命令面板，输入「回滚」直达检查点。" },
  { id: "t2", title: "拖文件进对话", body: "构建产物、截图直接拖入，agent 会自动解析。" },
]);
const reactions = ref<ReactionItem[]>([
  { id: "up", emoji: "👍", label: "有帮助", count: 12, active: true },
  { id: "fire", emoji: "🔥", count: 5 },
  { id: "eyes", emoji: "👀", count: 2 },
]);
const recVisible = ref(true);

/* ================= PromptLibrary + ChangeSummary ================= */
const prompts = [
  { id: "p1", title: "代码审查", body: "审查以下 diff，关注：并发安全 / 边界条件 / 命名一致性。\n输出：问题列表（按严重度）+ 修复建议。", category: "开发", tags: ["review", "diff"] },
  { id: "p2", title: "提交信息生成", body: "根据 staged diff 生成一条 conventional commit，正文说明动机而非行为。", category: "开发", tags: ["git"] },
  { id: "p3", title: "周报草稿", body: "根据本周提交与 PR 记录，按「进展 / 风险 / 下周计划」三段生成周报。", category: "效率", tags: ["report"] },
  { id: "p4", title: "API 文档补全", body: "为以下接口补 OpenAPI 注释：参数含义、错误码、示例请求。", category: "开发", tags: ["api"] },
];
const changedFiles: SummaryFile[] = [
  { path: "src/hooks/useUsers.ts", status: "modified", additions: 18, deletions: 6 },
  { path: "src/components/UserList.tsx", status: "modified", additions: 9, deletions: 3 },
  { path: "src/hooks/useForm.ts", status: "added", additions: 44 },
  { path: "src/App.tsx", status: "deleted", deletions: 12 },
  { path: "package.json", status: "modified", additions: 2, deletions: 1 },
];
</script>

<template>
  <div class="m6">
    <VaToaster />
    <p class="m6__lead">场景：agent 产品的设置与工作台页 —— 向导、集成、通知与反馈。</p>

    <div class="m6__grid">
      <section class="m6__panel">
        <h3>Profile Menu + Notification Stack</h3>
        <div class="m6__row">
          <VaProfileMenu
            name="张北"
            email="zhangbei@fastech.com"
            :badge="2"
            :items="[
              { id: 'profile', label: '个人资料' },
              { id: 'keys', label: 'API 密钥' },
              { id: 'logout', label: '退出登录', danger: true },
            ]"
            @select="(i) => vaToaster.add({ title: `点击：${i.label}`, kind: i.danger ? 'danger' : 'info' })"
          />
          <span class="m6__hint">头像菜单（Esc / 外部点击关闭）</span>
        </div>
        <VaNotificationStack
          class="m6__block"
          :notifications="notifications"
          @read="(id) => notifications = notifications.map(n => n.id === id ? { ...n, unread: false } : n)"
          @all-read="notifications = notifications.map(n => ({ ...n, unread: false }))"
          @open="(n) => vaToaster.add({ title: `打开通知：${n.title}` })"
        />
      </section>

      <section class="m6__panel">
        <h3>Setup Guide + Smart Recommendation</h3>
        <VaSetupGuide :steps="setupSteps" @complete="completeStep" @skip="(id) => setupSteps = setupSteps.map(s => s.id === id ? { ...s, status: 'skipped' } : s)" />
        <VaSmartRecommendation
          v-if="recVisible"
          class="m6__block"
          title="开启上下文自动压缩"
          description="长对话自动摘要历史消息，减少 token 消耗，不损失关键上下文。"
          impact="预计省 30% tokens"
          :actions="[
            { id: 'apply', label: '现在开启', primary: true },
            { id: 'later', label: '稍后' },
          ]"
          @action="(id) => { if (id === 'apply') vaToaster.add({ title: '已开启上下文压缩', kind: 'success' }); recVisible = false; }"
          @dismiss="recVisible = false"
        />
      </section>

      <section class="m6__panel m6__panel--wide">
        <h3>Stepper Form · 创建 agent 向导（第一步需填名称）</h3>
        <VaStepperForm
          v-model:step="step"
          :steps="[
            { id: 'name', title: '命名', description: '给 agent 起个名字，比如「代码审查员」' },
            { id: 'model', title: '模型', description: '选择驱动模型，之后可随时切换' },
            { id: 'confirm', title: '确认', description: '检查配置并创建' },
          ]"
          :next-disabled="!wizardOk"
          :submitting="submitting"
          @submit="onSubmit"
        >
          <template #step-name>
            <input v-model="wizardName" class="m6__input" placeholder="agent 名称…" aria-label="agent 名称">
          </template>
          <template #step-model>
            <VaCombobox v-model="model" :options="models" creatable placeholder="搜索或输入新模型名…" label="驱动模型" @create="(v) => vaToaster.add({ title: `已创建模型项：${v}`, kind: 'success' })" />
          </template>
          <template #step-confirm>
            <p class="m6__hint">名称：<b>{{ wizardName || "（空）" }}</b> · 模型：<b>{{ model }}</b></p>
          </template>
        </VaStepperForm>
      </section>

      <section class="m6__panel">
        <h3>OTP + Filter Menu + Date Range</h3>
        <div class="m6__row">
          <VaOtpInput v-model="otp" label="登录验证码" @complete="onOtpComplete" />
        </div>
        <div class="m6__row m6__block">
          <VaFilterMenu
            v-model="filterValue"
            trigger-label="任务筛选"
            :groups="[
              { id: 'kind', label: '类型', options: [{ value: 'review', label: '代码审查' }, { value: 'build', label: '构建' }, { value: 'test', label: '测试' }] },
              { id: 'env', label: '环境', type: 'radio', options: [{ value: 'prod', label: '生产' }, { value: 'staging', label: '预发' }] },
            ]"
            @clear="vaToaster.add({ title: '已清除筛选' })"
          />
          <span class="m6__hint">当前：{{ JSON.stringify(filterValue) }}</span>
        </div>
        <div class="m6__row">
          <VaDateRangePicker v-model:start="rangeStart" v-model:end="rangeEnd" @change="() => vaToaster.add({ title: '范围已更新', kind: 'info' })" />
        </div>
      </section>

      <section class="m6__panel m6__panel--wide">
        <h3>Prompt Library · 提示词库</h3>
        <VaPromptLibrary :prompts="prompts" @use="(p) => vaToaster.add({ title: `已插入：${p.title}`, description: p.body.slice(0, 30) + '…' })" />
      </section>

      <section class="m6__panel">
        <h3>Integration Picker · 连接服务</h3>
        <VaIntegrationPicker :items="integrations" @toggle="toggleIntegration" />
      </section>

      <section class="m6__panel">
        <h3>Integration Settings · GitHub 配置</h3>
        <VaIntegrationSettings
          v-model:enabled="ghEnabled"
          v-model:values="ghValues"
          name="GitHub"
          description="接入后 agent 可直接读仓库、开 PR、回复审查意见。"
          :fields="[
            { id: 'token', label: 'Personal Access Token', required: true, secret: true, placeholder: 'ghp_…', error: !ghValues.token ? '' : (ghValues.token.length < 8 ? 'Token 太短' : '') },
          ]"
          :saving="ghSaving"
          :saved-label="ghSaved"
          @save="saveGh"
          @disconnect="() => { integrations = integrations.map(i => i.id === 'gh' ? { ...i, connected: false } : i); vaToaster.add({ title: 'GitHub 已断开', kind: 'warning' }); }"
        />
      </section>

      <section class="m6__panel">
        <h3>Change Summary + Progress Tracker</h3>
        <VaChangeSummary
          title="重构用户列表页"
          :files="changedFiles"
          :duration="84_000"
          :tool-calls="7"
          :max-files="3"
          @open-file="(f) => vaToaster.add({ title: `查看 diff：${f.path}` })"
        />
        <VaProgressTracker
          class="m6__block"
          :steps="[{ label: '读取' }, { label: '编辑' }, { label: '构建', status: 'error' }, { label: '验证' }]"
          :current="2"
          @select="(i) => vaToaster.add({ title: `跳到步骤 ${i + 1}` })"
        />
      </section>

      <section class="m6__panel">
        <h3>Tips Panel + Reaction Bar</h3>
        <VaTipsPanel :tips="tips" dismissible @dismiss="(id) => tips = tips.filter(t => t.id !== id)" />
        <VaReactionBar
          class="m6__block"
          :reactions="reactions"
          @toggle="(item, next) => {
            reactions = reactions.map(r => r.id === item.id ? { ...r, active: next, count: (r.count ?? 0) + (next ? 1 : -1) } : r);
          }"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.m6 { display: flex; flex-direction: column; gap: 16px; }
.m6__lead { margin: 0; font-size: 13px; color: var(--va-muted, #6f6d66); }
.m6__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; align-items: start; }
.m6__panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  min-width: 0;
}
.m6__panel--wide { grid-column: 1 / -1; }
.m6__panel h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--va-muted, #6f6d66);
}
.m6__row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.m6__block { margin-top: 14px; }
.m6__hint { font-size: 12px; color: var(--va-muted, #6f6d66); }
.m6__input {
  border: 1px solid var(--va-edge, rgba(26,25,23,.12));
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13.5px;
  width: 100%;
  background: var(--va-bg, #f7f6f2);
  color: var(--va-ink, #1a1917);
}
</style>
