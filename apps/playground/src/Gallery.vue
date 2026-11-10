<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  VaAgentInbox,
  VaAgentPlan,
  VaApprovalCard,
  VaButton,
  VaComposer,
  VaContextWindow,
  VaDecisionInbox,
  VaGridBackground,
  VaInlineDiff,
  VaMemoryPanel,
  VaMessageActions,
  VaMessageText,
  VaModelPicker,
  VaNumberTicker,
  VaSegmentedControl,
  VaShimmerText,
  VaSkeleton,
  VaStreamAnswer,
  VaTextReveal,
  VaThinkingLoader,
  VaToolCallCard,
  VaToolCallGroup,
  vaToaster,
} from "@vuagent/ui";

/* 静态通知（duration 0 不自动消失，便于走查） */
onMounted(() => {
  vaToaster.add({ title: "组件已安装", description: "approval-card → components/ui", kind: "success", duration: 0 });
  vaToaster.add({ title: "需要审批", description: "pnpm add -D vitest", kind: "warning", duration: 0 });
  vaToaster.add({ title: "构建失败", kind: "danger", duration: 0 });
  vaToaster.add({ title: "普通信息通知", kind: "info", duration: 0 });
});

/* 分段控件 */
const segMd = ref("all");
const segSm = ref("free");

/* 工具卡（三条状态） */
const toolRunningFrom = Date.now() - 1800;
const t0 = Date.now() - 60_000;

/* 计划（运行到第 3 步） */
const planSteps = ref([
  { id: "p1", title: "读取路由与主题配置", status: "done" as const, duration: 900 },
  { id: "p2", title: "修改 Hero 组件文案", status: "done" as const, duration: 1500 },
  { id: "p3", title: "安装测试依赖", status: "running" as const, startedAt: Date.now() - 2000, detail: "pnpm add -D vitest" },
  { id: "p4", title: "运行构建验证", status: "pending" as const },
]);

/* 收件箱（5 种状态） */
const tasks = [
  { id: "t1", title: "整理 README 的组件导航", agent: "docs-agent", status: "running" as const, startedAt: Date.now() - 52_000, steps: ["已扫描 14 个组件目录", "生成导航草稿"] },
  { id: "t2", title: "为新组件补齐 Props 文档", agent: "docs-agent", status: "waiting" as const, startedAt: Date.now() - 30_000 },
  { id: "t3", title: "修复暗色模式对比度", agent: "ui-agent", status: "error" as const, duration: 41_000, error: "构建 1/3 失败", steps: ["定位 3 处低对比文本"] },
  { id: "t4", title: "生成变更日志", agent: "release-agent", status: "done" as const, duration: 12_400 },
  { id: "t5", title: "清理临时分支", agent: "git-agent", status: "queued" as const },
];

/* 上下文 */
const ctxParts = [
  { id: "c1", label: "system.md", tokens: 1800, kind: "system" as const },
  { id: "c2", label: "Hero.vue", tokens: 2400, kind: "file" as const },
  { id: "c3", label: "tokens.css", tokens: 900, kind: "file" as const },
  { id: "c4", label: "对话历史", tokens: 6200, kind: "history" as const },
  { id: "c5", label: "工具结果", tokens: 2100, kind: "tools" as const },
];

/* 决策 */
const decisions = [
  { id: "d1", title: "定价页新版本发布到生产环境", detail: "A/B 转化 +8.2%", primary: "立即发布", secondary: "再等一天", collapsed: true },
  { id: "d2", title: "给 30 天未活跃用户发召回邮件", primary: "发送", secondary: "先看名单" },
];

/* 记忆 */
const memEnabled = ref(true);
const memories = [
  { id: "m1", category: "偏好", text: "组件注释用中文，变量名用英文" },
  { id: "m2", category: "偏好", text: "提交信息遵循 Conventional Commits", paused: true },
  { id: "m3", category: "项目", text: "vuagent 使用 pnpm workspaces 管理" },
];

/* 消息 */
const msgText = "affectUI 的每个组件都是单个自包含文件，样式内嵌、零依赖。";
const msgVersion = ref(2);

/* 输入 */
const draft = ref("把 Hero 标题改成逐词浮现，并检查暗色对比度");
const model = ref("claude");
</script>

<template>
  <div class="gal">
    <div class="gal__grid">
      <!-- Button -->
      <section class="panel">
        <h3>Button</h3>
        <div class="row">
          <VaButton>主要</VaButton>
          <VaButton variant="secondary">次要</VaButton>
          <VaButton variant="ghost">幽灵</VaButton>
          <VaButton variant="destructive">删除</VaButton>
        </div>
        <div class="row">
          <VaButton size="sm" loading>加载</VaButton>
          <VaButton size="sm" variant="secondary" loading>加载</VaButton>
          <VaButton size="md" disabled>禁用</VaButton>
          <VaButton size="lg">大按钮</VaButton>
        </div>
      </section>

      <!-- SegmentedControl -->
      <section class="panel">
        <h3>Segmented Control</h3>
        <VaSegmentedControl
          v-model="segMd"
          full-width
          aria-label="示例"
          :options="[
            { value: 'all', label: '全部 22' },
            { value: 'free', label: '免费 22' },
            { value: 'pro', label: 'Pro 0', disabled: true },
          ]"
        />
        <VaSegmentedControl
          v-model="segSm"
          size="sm"
          aria-label="示例二"
          :options="[
            { value: 'free', label: '亮色' },
            { value: 'dark', label: '暗色' },
            { value: 'sys', label: '跟随系统' },
          ]"
        />
      </section>

      <!-- Skeleton / Shimmer -->
      <section class="panel">
        <h3>Skeleton / Shimmer Text</h3>
        <VaSkeleton width="72%" height="14" />
        <VaSkeleton width="90%" height="14" />
        <VaSkeleton width="45%" height="14" />
        <div class="row">
          <VaSkeleton width="44" height="44" circle />
          <VaShimmerText>正在思考下一步…</VaShimmerText>
        </div>
      </section>

      <!-- NumberTicker -->
      <section class="panel">
        <h3>Number Ticker</h3>
        <div class="big"><VaNumberTicker :value="48240" :format="{ maximumFractionDigits: 0 }" /></div>
        <div class="mid"><VaNumberTicker :value="1284" :format="{ style: 'currency', currency: 'CNY' }" /></div>
      </section>

      <!-- ThinkingLoader -->
      <section class="panel">
        <h3>Thinking Loader</h3>
        <div class="row" style="flex-wrap: wrap">
          <VaThinkingLoader :phases="['读取文件', '修改组件', '运行构建']" loop />
          <VaThinkingLoader done done-label="已完成 · 4.2s" />
          <VaThinkingLoader size="sm" :phases="['检索中']" loop />
        </div>
      </section>

      <!-- TextReveal / GridBackground -->
      <section class="panel">
        <h3>Text Reveal + Grid Background</h3>
        <VaGridBackground :size="36" :speed="2" style="border-radius: 12px; padding: 16px">
          <VaTextReveal as="p" by="word" :stagger="60" text="为 AI 产品而生的 Agent Ops 组件库" style="font-size: 16px; font-weight: 700" />
        </VaGridBackground>
      </section>

      <!-- ToolCallCard 三态 -->
      <section class="panel">
        <h3>Tool Call Card（三态）</h3>
        <div class="stack">
          <VaToolCallCard name="fs.read" summary="读取 tokens.css" status="running" :args="{ file: 'tokens.css' }" :started-at="toolRunningFrom" />
          <VaToolCallCard name="fs.edit" summary="修改 Hero 组件（2 处）" status="success" :args="{ file: 'Hero.vue', changes: 2 }" :result="{ ok: true, lines: 18 }" :duration="1420" default-open />
          <VaToolCallCard name="pm.install" summary="安装 vitest" status="error" :args="{ packages: ['vitest'] }" error="registry 401：访问令牌已过期，请重新登录" :duration="2600" default-open />
        </div>
      </section>

      <!-- ToolCallGroup -->
      <section class="panel">
        <h3>Tool Call Group</h3>
        <VaToolCallGroup default-open label="本轮共用了 3 个工具">
          <VaToolCallCard name="search_web" summary="搜索 2026 CRM 定价" status="success" :args="{ query: 'crm pricing 2026' }" :result="{ results: 12 }" :started-at="t0" :duration="1600" />
          <VaToolCallCard name="crm.lookup" summary="查询客户档案" status="success" :args="{ domain: 'acme.com' }" :result="{ plan: 'Team' }" :started-at="t0" :duration="900" />
          <VaToolCallCard name="email.draft" summary="起草跟进邮件" status="error" error="模板渲染失败：变量 {{name}} 缺失" :started-at="t0" :duration="1100" />
        </VaToolCallGroup>
      </section>

      <!-- AgentPlan -->
      <section class="panel">
        <h3>Agent Plan（运行中）</h3>
        <VaAgentPlan :steps="planSteps" />
      </section>

      <!-- ApprovalCard -->
      <section class="panel">
        <h3>Approval Card</h3>
        <VaApprovalCard
          title="agent 想安装新的开发依赖"
          detail="vitest · 用于构建验证"
          risk="high"
          preview="pnpm add -D vitest@^3.2.4"
          :countdown="120"
        />
      </section>

      <!-- DecisionInbox -->
      <section class="panel">
        <h3>Decision Inbox</h3>
        <VaDecisionInbox :decisions="decisions" />
      </section>

      <!-- AgentInbox -->
      <section class="panel">
        <h3>Agent Inbox（5 态，t1 展开）</h3>
        <VaAgentInbox :tasks="tasks" :key="0" />
      </section>

      <!-- ContextWindow -->
      <section class="panel">
        <h3>Context Window</h3>
        <VaContextWindow :parts="ctxParts" :capacity="32_000" />
      </section>

      <!-- InlineDiff -->
      <section class="panel">
        <h3>Inline Diff</h3>
        <VaInlineDiff original="点击按钮后，界面会立刻刷新并显示加载动画。" revised="点击按钮后，界面会立即刷新，并显示微光加载动画。" title="Hero 副标题" />
      </section>

      <!-- MemoryPanel -->
      <section class="panel">
        <h3>Memory Panel</h3>
        <VaMemoryPanel v-model:enabled="memEnabled" :memories="memories" />
      </section>

      <!-- Composer + ModelPicker -->
      <section class="panel">
        <h3>Composer + Model Picker</h3>
        <VaComposer v-model:text="draft" @send="(t) => vaToaster.add({ title: '任务已提交', description: t.slice(0, 32), kind: 'success' })">
          <template #prefix>
            <VaModelPicker v-model:selected="model" />
          </template>
        </VaComposer>
      </section>

      <!-- StreamAnswer -->
      <section class="panel">
        <h3>Stream Answer</h3>
        <VaStreamAnswer source="已把 Hero 标题改为逐词浮现，并为暗色模式补齐对比度。改动涉及 2 个文件，构建通过。" />
      </section>

      <!-- MessageActions / Text -->
      <section class="panel">
        <h3>Message Actions / Text</h3>
        <VaMessageText :version="msgVersion">{{ msgText }}</VaMessageText>
        <div style="margin-top: 8px">
          <VaMessageActions v-model:version="msgVersion" :text="msgText" :versions="3" quiet />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.gal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 16px;
  align-items: start;
}
.panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  min-width: 0;
  display: grid;
  gap: 10px;
  justify-items: start;
}
.panel h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--va-muted, #6f6d66);
}
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.stack { display: grid; gap: 6px; width: 100%; }
.big { font-size: 36px; font-weight: 800; letter-spacing: -0.02em; }
.mid { font-size: 22px; font-weight: 700; }
</style>
