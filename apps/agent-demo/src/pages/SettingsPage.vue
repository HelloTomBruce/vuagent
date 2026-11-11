<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  VaDateRangePicker,
  VaIntegrationPicker,
  VaIntegrationSettings,
  VaNotificationStack,
  VaOtpInput,
  VaPricingPlans,
  VaProfileMenu,
  VaPromptLibrary,
  VaSetupGuide,
  VaTipsPanel,
  VaToaster,
  VaUsageMeter,
  addDays,
  dayStart,
  vaToaster,
} from "@vuagent/ui";
import type { IntegrationItem, SetupStep } from "@vuagent/ui";
import { useAgentEngine } from "../engine/useAgentEngine";

const router = useRouter();
const { state, usePrompt, markAllRead, markRead } = useAgentEngine();

const section = ref("profile");

/* SetupGuide */
const setupSteps = ref<SetupStep[]>([
  { id: "cli", title: "安装 CLI", description: "npm i -g vuagent-cli", status: "done" as const },
  { id: "key", title: "配置 API Key", description: "在下方 GitHub 集成里填入", status: "done" as const },
  { id: "repo", title: "连接第一个仓库", optional: true },
]);

/* 集成 */
const integrations = ref<IntegrationItem[]>([
  { id: "gh", name: "GitHub", description: "仓库、Issue 与 PR 联动", connected: true },
  { id: "slack", name: "Slack", description: "任务完成通知到频道" },
  { id: "feishu", name: "飞书", description: "审批卡片直达" },
]);
function toggleIntegration(item: IntegrationItem) {
  integrations.value = integrations.value.map((i) => (i.id === item.id ? { ...i, connected: !i.connected } : i));
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

/* 提示词库 */
const prompts = [
  { id: "p1", title: "周报生成", body: "根据本周提交与 PR 记录，按「进展 / 风险 / 下周计划」三段生成周报。", category: "效率", tags: ["report"] },
  { id: "p2", title: "代码审查", body: "审查以下 diff，关注并发安全、边界条件、命名一致性，按严重度输出问题列表。", category: "开发", tags: ["review"] },
  { id: "p3", title: "数据对比", body: "对比两组任务指标的完成率与显著性，给出是否切换的建议。", category: "分析", tags: ["experiment"] },
  { id: "p4", title: "API 文档补全", body: "为以下接口补 OpenAPI 注释：参数含义、错误码、示例请求。", category: "开发", tags: ["api"] },
];
function onUsePrompt(p: { body: string; title: string }) {
  usePrompt(p.body);
  vaToaster.add({ title: `已插入提示词：${p.title}`, description: "回到「对话」直接发送", kind: "success" });
  router.push("/chat");
}

/* OTP / 账单周期 */
const otp = ref("");
function onOtp(v: string) {
  vaToaster.add({ title: "验证通过", description: v, kind: "success" });
}

const rangeStart = ref(addDays(dayStart(Date.now()), -6));
const rangeEnd = ref(dayStart(Date.now()));

const unread = computed(() => state.notifications.filter((n) => n.unread).length);
</script>

<template>
  <div class="settings-page">
    <aside class="side">
      <h3 class="side-title">设置</h3>
      <button
        v-for="s in [
          { id: 'profile', label: '账户' },
          { id: 'integrations', label: '集成' },
          { id: 'prompts', label: '提示词库' },
          { id: 'usage', label: '用量与账单' },
          { id: 'notify', label: '通知' },
        ]"
        :key="s.id"
        class="side-item"
        type="button"
        :data-active="section === s.id"
        @click="section = s.id"
      >
        {{ s.label }}
        <span v-if="unread && (s.id === 'notify' || s.id === 'profile')" class="side-badge">{{ unread }}</span>
      </button>
    </aside>

    <main class="main">
      <!-- 账户 -->
      <template v-if="section === 'profile'">
        <h3 class="sec-title">账户</h3>
        <div class="card profile">
          <VaProfileMenu name="张北" email="zhangbei@fastech.com" :items="[]" />
          <span class="profile-name">张北 · Pro 套餐</span>
        </div>
        <VaSetupGuide
          class="card"
          :steps="setupSteps"
          @complete="(id) => { setupSteps = setupSteps.map(s => s.id === id ? { ...s, status: 'done' } : s); }"
          @skip="(id) => { setupSteps = setupSteps.map(s => s.id === id ? { ...s, status: 'skipped' } : s); }"
        />
        <div class="card">
          <h4 class="card-h">绑定手机（OTP 演示）</h4>
          <VaOtpInput v-model="otp" @complete="onOtp" />
          <p class="hint">输入任意 6 位数字，填满即"验证通过"</p>
        </div>
        <VaTipsPanel
          :tips="[
            { id: 't1', title: '⌘K 命令面板', body: '任意页面按 ⌘K（或 Ctrl+K）唤起，可跳页、直接触发剧本。' },
            { id: 't2', title: '三个剧本', body: '对话页输入「生成周报 / 重构用户列表页 / 分析任务数据」看完整流程。' },
          ]"
          dismissible
          @dismiss="() => {}"
        />
      </template>

      <!-- 集成 -->
      <template v-else-if="section === 'integrations'">
        <h3 class="sec-title">集成</h3>
        <VaIntegrationPicker :items="integrations" @toggle="toggleIntegration" @select="() => {}" />
        <VaIntegrationSettings
          class="mt"
          v-model:enabled="ghEnabled"
          v-model:values="ghValues"
          name="GitHub"
          description="接入后 agent 可直接读仓库、开 PR、回复审查意见。"
          :fields="[{ id: 'token', label: 'Personal Access Token', required: true, secret: true, placeholder: 'ghp_…' }]"
          :saving="ghSaving"
          :saved-label="ghSaved"
          @save="saveGh"
          @disconnect="() => { integrations = integrations.map(i => i.id === 'gh' ? { ...i, connected: false } : i); }"
        />
      </template>

      <!-- 提示词库 -->
      <template v-else-if="section === 'prompts'">
        <h3 class="sec-title">提示词库</h3>
        <VaPromptLibrary :prompts="prompts" @use="onUsePrompt" />
      </template>

      <!-- 用量与账单 -->
      <template v-else-if="section === 'usage'">
        <h3 class="sec-title">用量与账单</h3>
        <VaUsageMeter
          :segments="state.usage.segments"
          :limit="state.usage.limit"
          unit="tokens"
          period="今日 · 明早 8 点重置"
          @manage="() => vaToaster.add({ title: '跳转额度管理（demo）' })"
        />
        <div class="mt card">
          <h4 class="card-h">账单周期</h4>
          <VaDateRangePicker v-model:start="rangeStart" v-model:end="rangeEnd" />
        </div>
        <VaPricingPlans
          class="mt"
          :tiers="[
            { id: 'free', name: 'Free', price: '$0', period: '永久', description: '尝鲜与个人项目', features: ['每月 50 次运行', '2 个 agent'], current: true },
            { id: 'pro', name: 'Pro', price: '$20', period: '按月', description: '重度使用', features: ['无限运行', '优先模型', '检查点回滚'], recommended: true, ctaLabel: '升级到 Pro' },
          ]"
          @choose="(t) => vaToaster.add({ title: `选择：${t.name}`, kind: 'success' })"
        />
      </template>

      <!-- 通知 -->
      <template v-else>
        <h3 class="sec-title">通知</h3>
        <VaNotificationStack
          :notifications="state.notifications"
          @read="markRead"
          @all-read="markAllRead"
          @open="(n) => vaToaster.add({ title: `打开：${n.title}` })"
        />
      </template>
    </main>
    <VaToaster />
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1080px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 760px) { .settings-page { grid-template-columns: 1fr; } }

.side { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 76px; }
.side-title { margin: 0 0 10px; font-size: 13px; font-weight: 700; }
.side-item {
  display: flex; justify-content: space-between; align-items: center;
  border: 0; border-radius: 8px; background: transparent; color: var(--va-ink-2);
  font: inherit; font-size: 13px; padding: 7px 10px; cursor: pointer; text-align: left;
}
.side-item:hover { background: var(--va-bg-subtle); }
.side-item[data-active="true"] { background: var(--va-card); font-weight: 600; box-shadow: 0 1px 2px rgba(26,25,23,.06); }
.side-badge {
  min-width: 18px; height: 18px; border-radius: 999px; background: var(--va-accent);
  color: var(--va-card); font-size: 10.5px; font-weight: 700; line-height: 18px; text-align: center; padding: 0 5px;
}

.main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.sec-title { margin: 0; font-size: 15px; font-weight: 700; }
.card {
  background: var(--va-card); border: 1px solid var(--va-edge);
  border-radius: 14px; padding: 16px;
}
.card-h { margin: 0 0 12px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--va-muted); }
.profile { display: flex; align-items: center; gap: 14px; }
.profile-name { font-size: 13.5px; font-weight: 600; }
.hint { margin: 10px 0 0; font-size: 12px; color: var(--va-muted); }
.mt { margin-top: 18px; }
</style>
