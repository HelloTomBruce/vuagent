<script setup lang="ts">
import { ref } from "vue";
import { withBase } from "vitepress";

const installCmd = "npm i @vuagent/ui @vuagent/server @vuagent/protocol";
const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installCmd);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    /* 剪贴板不可用时静默：文本本身可手动圈选 */
  }
}

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
          <div class="lh-steps__codebox">
            <button
              v-if="s.num === '01'"
              type="button"
              class="lh-steps__copy"
              @click="copyInstall"
            >{{ copied ? "已复制 ✓" : "复制" }}</button>
            <pre class="lh-steps__code"><code>{{ s.code }}</code></pre>
          </div>
        </div>
      </div>

      <!-- 终局 CTA 行 -->
      <div class="lh-steps__cta">
        <code class="lh-steps__cta-cmd"><span class="dollar">$</span>{{ installCmd }}</code>
        <button type="button" class="lh-steps__cta-copy" @click="copyInstall">
          {{ copied ? "已复制 ✓" : "复制命令" }}
        </button>
        <a class="lh-steps__cta-btn" :href="withBase('/guide/getting-started')">阅读接入指南</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-steps { background: #141311; }
.lh-steps__inner { max-width: 1280px; margin: 0 auto; padding: 76px 32px; }
.lh-sec-title { margin: 0; font-size: 34px; font-weight: 800; color: #f0eee9; }
.lh-sec-sub { margin: 12px 0 0; font-size: 15px; color: rgba(240, 238, 233, 0.74); max-width: 780px; line-height: 1.8; }
.lh-steps__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 40px;
  align-items: start;
}
.lh-steps__card {
  background: #1c1a17;
  border: 1px solid rgba(240, 238, 233, 0.14);
  border-radius: 14px;
  overflow: hidden;
}
.lh-steps__card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(240, 238, 233, 0.1);
}
.lh-steps__num {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--va-accent, #c2410c); color: #ffffff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.lh-steps__title { font-size: 13px; font-weight: 700; color: #f0eee9; }
.lh-steps__codebox { position: relative; }
.lh-steps__copy {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
  font-size: 11px;
  font-weight: 600;
  color: rgba(240, 238, 233, 0.72);
  background: rgba(20, 19, 17, 0.85);
  border: 1px solid rgba(240, 238, 233, 0.2);
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
}
.lh-steps__copy:hover { color: #e8925e; border-color: #e8925e; }
.lh-steps__code {
  margin: 0;
  padding: 14px 16px 16px;
  background: #0b0f14;
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.75;
  color: var(--ink-inverse, #f0eee9);
  overflow-x: auto;
  min-height: 240px;
  white-space: pre;
}
.lh-steps__cta {
  margin-top: 30px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  background: #1c1a17;
  border: 1px solid rgba(232, 146, 94, 0.28);
  border-radius: 12px;
  padding: 14px 18px;
}
.lh-steps__cta-cmd {
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 14px;
  color: #f0eee9;
  overflow-x: auto;
  white-space: nowrap;
}
.lh-steps__cta-cmd .dollar { color: #e8925e; margin-right: 8px; }
.lh-steps__cta-copy {
  font-size: 12px;
  font-weight: 600;
  color: #f0eee9;
  background: none;
  border: 1px solid rgba(240, 238, 233, 0.22);
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
}
.lh-steps__cta-copy:hover { color: #e8925e; border-color: #e8925e; }
.lh-steps__cta-btn {
  margin-left: auto;
  font-size: 13px;
  font-weight: 700;
  padding: 9px 20px;
  border-radius: 8px;
  background: var(--va-accent, #c2410c);
  color: #ffffff;
  text-decoration: none;
}
.lh-steps__cta-btn:hover { background: #d9531e; }
@media (max-width: 1100px) {
  .lh-steps__row { grid-template-columns: 1fr; }
  .lh-steps__code { min-height: 0; }
}
</style>
