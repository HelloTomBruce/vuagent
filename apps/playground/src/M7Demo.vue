<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VaAgentChat,
  VaAgentRun,
  VaAgentPlan,
  VaAgentTeam,
  VaAiAnswer,
  VaAppShell,
  VaBlurCrossfade,
  VaBreakdownChart,
  VaCodeDiff,
  VaCompactBreakdown,
  VaComposer,
  VaContextWindow,
  VaExperimentCard,
  VaGradientText,
  VaKpiChart,
  VaModelPicker,
  VaModelWheel,
  VaOnboarding,
  VaPricingPlans,
  VaTerminalLog,
  VaToaster,
  VaUsageMeter,
  VaVoiceOrb,
  vaToaster,
} from "@vuagent/ui";
import type { KpiChartProps, PlanStep } from "@vuagent/ui";

const active = ref("dashboard");
const nav = [
  { id: "dashboard", label: "总览" },
  { id: "chat", label: "对话" },
  { id: "run", label: "运行" },
  { id: "onboarding", label: "接入" },
  { id: "billing", label: "订阅" },
];

/* ================= 总览：KPI + 图表 + 实验 ================= */
const kpis: KpiChartProps[] = [
  { label: "今日 agent 运行", value: 1284, delta: 0.12, deltaLabel: "较上周", series: [8, 11, 9, 14, 13, 17, 16, 19] },
  { label: "完成任务", value: 963, delta: 0.08, deltaLabel: "较上周", series: [5, 7, 6, 9, 11, 10, 13, 14] },
  { label: "失败率", value: 0.021, format: { style: "percent", maximumFractionDigits: 1 }, delta: -0.35, deltaLabel: "较上周", invertDelta: true, series: [8, 7, 6, 6, 4, 4, 3, 2] },
];

const breakdown = [
  { label: "代码审查", value: 412 },
  { label: "构建", value: 318 },
  { label: "测试", value: 186 },
  { label: "文档", value: 84 },
  { label: "其他", value: 32 },
];

/* AiAnswer */
const answer = ref("可以。通过 registry 单文件安装[1]，也可以整包 npm 安装后按需引入[2]。两种方式都零运行时依赖。");
const sources = [
  { id: "s1", title: "快速开始 · registry 安装", origin: "vuagent.dev" },
  { id: "s2", title: "@vuagent/ui · npm", origin: "npmjs.com" },
];

/* BlurCrossfade demo */
const xfKey = ref(0);
const xfTexts = ["让 agent 接手重复工作", "60+ 组件 · 零依赖 · 单文件可拷", "为 AI 产品而生的 Agent Ops 组件库"];
const xfText = computed(() => xfTexts[xfKey.value % xfTexts.length]!);

/* ================= 运行页 ================= */
const planSteps = ref<PlanStep[]>([
  { id: "1", title: "读取仓库结构", status: "done", duration: 1200 },
  { id: "2", title: "定位用户模块", status: "done", duration: 3400 },
  { id: "3", title: "重构 useUsers（分页 + 取消）", status: "running" },
  { id: "4", title: "跑测试", status: "pending" },
]);

const DIFF = {
  old: `export function useUsers() {\n  const [users, setUsers] = useState([]);\n  useEffect(() => {\n    fetch("/api/users")\n      .then((r) => r.json())\n      .then(setUsers);\n  }, []);\n  return { users };\n}`,
  new: `export function useUsers(page = 1) {\n  const [users, setUsers] = useState([]);\n  useEffect(() => {\n    const ac = new AbortController();\n    fetch(\`/api/users?page=\${page}\`, { signal: ac.signal })\n      .then((r) => r.json())\n      .then(setUsers);\n    return () => ac.abort();\n  }, [page]);\n  return { users };\n}`,
};

const ESC = "\u001b";
const term = [
  { text: "pnpm test", kind: "cmd" as const },
  `${ESC}[32m✓${ESC}[22m 42 passed`,
  `${ESC}[33m1 file changed${ESC}[39m (+18 −6)`,
  `${ESC}[32m✓ done in 1.4s${ESC}[39m`,
];

/* Chat */
const chatDraft = ref("");
const chatModel = ref("claude");
const chatMessages = ref([
  { id: "m1", role: "user" as const, text: "把用户列表改成分页加载" },
  { id: "m2", role: "agent" as const, text: "已完成：加入 page 参数与 AbortController 取消，测试通过。", tools: ["read_file", "edit_file", "run_tests"] },
]);
const chatThinking = ref(false);
function sendChat(text: string) {
  chatMessages.value = [...chatMessages.value, { id: `m${chatMessages.value.length + 1}`, role: "user", text }];
  chatThinking.value = true;
  window.setTimeout(() => {
    chatThinking.value = false;
    chatMessages.value = [...chatMessages.value, { id: `a${chatMessages.value.length}`, role: "agent", text: `已处理：「${text}」的执行计划已生成，去「运行」页查看。`, tools: ["plan"] }];
  }, 1600);
}
</script>

<template>
  <div class="m7">
    <VaToaster />
    <VaAppShell v-model:active="active" brand="Vuagent Ops" :nav="nav">
      <template #topbar>
        <VaModelPicker v-model:selected="chatModel" />
        <span style="flex: 1" />
        <VaUsageMeter
          style="min-width: 260px"
          :segments="[{ label: 'Fast', used: 412_000 }, { label: 'Slow', used: 168_000 }]"
          :limit="800_000"
          unit="tokens"
          period="今日"
        />
      </template>

      <!-- 总览 -->
      <template v-if="active === 'dashboard'">
        <div class="m7__kpis">
          <VaKpiChart v-for="k in kpis" :key="k.label" v-bind="k" />
        </div>

        <div class="m7__row">
          <section class="m7__card m7__card--wide">
            <h3>任务类型分布</h3>
            <VaBreakdownChart :items="breakdown" unit="次" :max-rows="5" @select="(r) => vaToaster.add({ title: `筛选：${r.label}` })" />
          </section>
          <section class="m7__card">
            <h3>模型用量占比</h3>
            <VaCompactBreakdown :segments="[{ label: 'Claude', value: 500 }, { label: 'GPT', value: 280 }, { label: 'GLM', value: 220 }]" />
            <VaBlurCrossfade class="m7__xfade" :target="xfKey">
              <p class="m7__xfade-text"><VaGradientText animated :text="xfText" /></p>
            </VaBlurCrossfade>
            <button class="m7__mini" type="button" @click="xfKey++">下一句（BlurCrossfade）</button>
          </section>
        </div>

        <div class="m7__row">
          <section class="m7__card">
            <h3>实验：提示词改写</h3>
            <VaExperimentCard
              title="系统提示词 v2"
              metric="任务完成率"
              status="success"
              :confidence="0.97"
              :variants="[
                { id: 'a', name: 'v1 基线', value: 0.62, format: { style: 'percent' } },
                { id: 'b', name: 'v2 改写', value: 0.71, delta: 0.145, format: { style: 'percent' } },
              ]"
            />
          </section>
          <section class="m7__card">
            <h3>AI Answer（带引用）</h3>
            <VaAiAnswer question="vuagent 怎么安装？" :answer="answer" :sources="sources" @source="(s) => vaToaster.add({ title: `打开来源：${s.title}` })" />
          </section>
          <section class="m7__card m7__card--deco">
            <h3>插画</h3>
            <div class="m7__deco">
              <VaVoiceOrb state="speaking" :size="84" />
              <VaAgentTeam :agents="[{ id: 'a', name: 'Coder' }, { id: 'b', name: 'Reviewer' }, { id: 'c', name: 'Tester' }]" :size="140" />
              <VaModelWheel :models="[{ id: 'm1', name: 'Claude' }, { id: 'm2', name: 'GPT' }, { id: 'm3', name: 'GLM' }, { id: 'm4', name: 'Qwen' }]" center-label="4 模型" :size="140" />
            </div>
          </section>
        </div>
      </template>

      <!-- 对话 -->
      <template v-else-if="active === 'chat'">
        <div class="m7__chat-wrap">
          <VaAgentChat title="代码助手" :messages="chatMessages" :thinking="chatThinking">
            <template #composer>
              <VaComposer v-model:text="chatDraft" :busy="chatThinking" @send="sendChat">
                <template #prefix><VaModelPicker v-model:selected="chatModel" /></template>
              </VaComposer>
            </template>
          </VaAgentChat>
        </div>
      </template>

      <!-- 运行 -->
      <template v-else-if="active === 'run'">
        <VaAgentRun
          title="重构用户列表页"
          status="running"
          status-label="正在执行第 3/4 步"
          :duration="46_200"
        >
          <template #plan>
            <VaAgentPlan :steps="planSteps" @retry="(s) => vaToaster.add({ title: `重试：${s.title}` })" />
          </template>
          <VaCodeDiff file-name="src/hooks/useUsers.ts" :old-text="DIFF.old" :new-text="DIFF.new" :max-height="260" />
          <VaTerminalLog class="m7__term" title="bash — pnpm test" :lines="term" :max-height="180" />
          <template #aside>
            <VaContextWindow
              :parts="[
                { id: 'sys', label: '系统提示', tokens: 1_800, kind: 'system' },
                { id: 'f1', label: 'useUsers.ts', tokens: 3_200, kind: 'file' },
                { id: 'hist', label: '对话历史', tokens: 12_000, kind: 'history' },
              ]"
              :capacity="32_000"
            />
          </template>
        </VaAgentRun>
      </template>

      <!-- 接入 -->
      <template v-else-if="active === 'onboarding'">
        <VaOnboarding
          brand="Vuagent Ops"
          title="让 agent 接手重复工作"
          subtitle="三步接入你的仓库：装 CLI、配 API Key、连 GitHub。"
          secondary-cta-label="看文档"
          @cta="vaToaster.add({ title: '开始接入（demo）' })"
          @secondary-cta="vaToaster.add({ title: '跳转文档（demo）' })"
        />
      </template>

      <!-- 订阅 -->
      <template v-else>
        <VaPricingPlans
          :tiers="[
            { id: 'free', name: 'Free', price: '$0', period: '永久', description: '尝鲜与个人项目', features: ['每月 50 次运行', '2 个 agent', '社区支持'], current: true },
            { id: 'pro', name: 'Pro', price: '$20', period: '按月', description: '重度使用与团队协作', features: ['无限运行', '不限 agent', '优先模型队列', '检查点回滚'], recommended: true, ctaLabel: '升级到 Pro' },
            { id: 'team', name: 'Team', price: '$99', period: '按月', description: '团队共享与审计', features: ['包含 Pro 全部', '共享提示词库', '审计日志', 'SSO'], ctaLabel: '联系开通' },
          ]"
          @choose="(t) => vaToaster.add({ title: `选择：${t.name}` })"
        />
      </template>
    </VaAppShell>
  </div>
</template>

<style scoped>
.m7 { margin: -24px -8px; }
.m7__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 16px; }
.m7__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; align-items: start; margin-bottom: 16px; }
.m7__card {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: 14px;
  padding: 16px;
  min-width: 0;
}
.m7__card--wide { grid-column: span 2; }
.m7__card h3 { margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--va-muted, #6f6d66); }
.m7__xfade { margin-top: 14px; }
.m7__xfade-text { margin: 0; font-size: 14px; font-weight: 700; }
.m7__mini {
  margin-top: 10px; border: 1px solid var(--va-edge); border-radius: 8px; background: transparent;
  color: var(--va-muted); font-size: 12px; padding: 3px 10px; cursor: pointer;
}
.m7__deco { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; justify-content: center; padding: 8px 0; }
.m7__chat-wrap { height: 560px; }
.m7__term { margin-top: 12px; }
</style>
