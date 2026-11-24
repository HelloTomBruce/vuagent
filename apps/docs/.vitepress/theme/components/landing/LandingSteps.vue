<script setup lang="ts">
const steps = [
  {
    num: "01",
    title: "安装组件库与服务端",
    lang: "bash",
    code: `npm i @vuagent/ui @vuagent/server @vuagent/protocol

# 或 shadcn-vue 单文件拷贝（代码完全可控）：
npx shadcn-vue add @vuagent/approval-card`,
  },
  {
    num: "02",
    title: "起 Harness 服务端，注册业务工具",
    lang: "ts",
    code: `import { createHarnessServer } from "@vuagent/server";
import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

const inspectTool: HarnessTool = {
  name: "inspect_cluster",
  description: "检查微服务集群健康度",
  parameters: Type.Object({
    service: Type.String({ description: "服务名" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return { status: "healthy", pods: [] /* 业务数据 */ };
  },
};

const { app } = createHarnessServer({
  dbPath: ".vuagent/harness.db",
  customTools: [inspectTool],
});`,
  },
  {
    num: "03",
    title: "前端注册卡片，消息流自动挂载",
    lang: "ts",
    code: `import { registerCardComponent } from "@vuagent/ui";
import ClusterHealthCard from "./ClusterHealthCard.vue";

// 工具返回 { rendered: true, component: "ui_cluster_health", props }
// 消息流渲染分发器自动挂载对应卡片
registerCardComponent("ui_cluster_health", ClusterHealthCard);`,
  },
];
</script>

<template>
  <section class="lh-steps">
    <div class="lh-steps__inner">
      <h2 class="lh-sec-title">三步接入，业务工具即 Agent 能力</h2>
      <p class="lh-sec-sub">
        任何能写成函数的业务能力，加上一份 TypeBox 契约就是 agent 的工具；
        工具返回组件声明，界面自动获得 Generative UI。以下代码与 examples/ 案例同源。
      </p>
      <div class="lh-steps__row">
        <div v-for="s in steps" :key="s.num" class="lh-steps__card">
          <div class="lh-steps__card-head">
            <span class="lh-steps__num">{{ s.num }}</span>
            <span class="lh-steps__title">{{ s.title }}</span>
          </div>
          <pre class="lh-steps__code"><code :class="`lang-${s.lang}`">{{ s.code }}</code></pre>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-steps { background: var(--va-ground-light, #f7f6f2); }
.lh-steps__inner { max-width: 1180px; margin: 0 auto; padding: 72px 32px; }
.lh-sec-title { margin: 0; font-size: 34px; font-weight: 800; color: var(--va-ink, #1a1917); }
.lh-sec-sub { margin: 12px 0 0; font-size: 15px; color: var(--va-muted, #6f6d66); max-width: 780px; line-height: 1.8; }
.lh-steps__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 40px;
  align-items: start;
}
.lh-steps__card {
  background: var(--va-card, #ffffff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.1));
  border-radius: 14px;
  overflow: hidden;
}
.lh-steps__card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.1));
}
.lh-steps__num {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--va-accent, #c2410c); color: #ffffff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.lh-steps__title { font-size: 13px; font-weight: 700; color: var(--va-ink, #1a1917); }
.lh-steps__code {
  margin: 0;
  padding: 14px 16px 16px;
  background: var(--va-ground-dark, #141311);
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.75;
  color: var(--ink-inverse, #f0eee9);
  overflow-x: auto;
  min-height: 240px;
  white-space: pre;
}
@media (max-width: 1100px) {
  .lh-steps__row { grid-template-columns: 1fr; }
  .lh-steps__code { min-height: 0; }
}
</style>
