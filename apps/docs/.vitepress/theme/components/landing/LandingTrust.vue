<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";
import { components } from "../../../../../../meta/components.mjs";

const total = computed(() => components.length);
const installCmd = "npm i @vuagent/ui @vuagent/server @vuagent/protocol";
const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installCmd);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    /* 剪贴板不可用时静默 */
  }
}

/** 证据链：真实可核验的入口，替代自我声明卡 */
const evidence = [
  { label: "GitHub 仓库", href: "https://github.com/HelloTomBruce/vuagent", note: "源码 · Issues" },
  { label: "Releases v0.3.0", href: "https://github.com/HelloTomBruce/vuagent/releases", note: "三包 fixed 联动发版" },
  { label: "CHANGELOG", href: "https://github.com/HelloTomBruce/vuagent/blob/main/packages/ui/CHANGELOG.md", note: "逐版本变更记录" },
  { label: "llms-full.txt", href: "https://hellotombruce.github.io/vuagent/llms-full.txt", note: "AI 编码工具专用全量 API" },
  { label: "examples 源码", href: "https://github.com/HelloTomBruce/vuagent/tree/main/examples/agent-gallery", note: "三场景接入案例" },
];

const specs = [
  { title: "契约单一事实来源", desc: "TypeBox Schema 单向推导三端类型，杜绝漂移" },
  { title: "强类型端到端", desc: "Props / 事件 / 18 种 SSE 事件全部有型可查" },
  { title: "零运行时依赖", desc: "peer 仅 vue ^3.5，图标随构建内联，装完即用" },
  { title: "诚实的恢复语义", desc: "进程重启不假装续跑：中断轮次诚实标记，checkpoint 进度保留可查" },
  { title: "亮暗双主题", desc: "--va-* 设计令牌一键换肤，跟随 data-theme" },
  { title: "动效尊重系统", desc: "全部动效遵循 prefers-reduced-motion" },
];
</script>

<template>
  <section class="lh-trust">
    <div class="lh-trust__inner">
      <!-- 终局 CTA -->
      <div class="lh-trust__cta">
        <code class="lh-trust__cmd"><span class="dollar">$</span>{{ installCmd }}</code>
        <button type="button" class="lh-trust__copy" @click="copyInstall">
          {{ copied ? "已复制 ✓" : "复制命令" }}
        </button>
        <a class="lh-trust__cta-btn" :href="withBase('/guide/getting-started')">阅读接入指南</a>
      </div>

      <!-- 证据链 -->
      <h2 class="lh-sec-title">证据链：自己看，别听我说</h2>
      <div class="lh-trust__evidence">
        <a v-for="e in evidence" :key="e.label" class="lh-trust__ev" :href="e.href" target="_blank" rel="noreferrer">
          <span class="lh-trust__ev-label">{{ e.label }} ↗</span>
          <span class="lh-trust__ev-note">{{ e.note }}</span>
        </a>
      </div>

      <!-- 规格速览 -->
      <div class="lh-trust__specs">
        <div v-for="b in specs" :key="b.title" class="lh-trust__spec">
          <span class="lh-trust__spec-title">{{ b.title }}</span>
          <p class="lh-trust__spec-desc">{{ b.desc }}</p>
        </div>
      </div>

      <div class="lh-trust__footer">
        <span class="lh-trust__brand">vuagent<span class="dot">.</span></span>
        <span class="lh-trust__meta">3 组件包 · {{ total }} 组件 · MIT License · 三包 fixed 联动发版</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-trust {
  background: #141311;
}
.lh-trust__inner { max-width: 1280px; margin: 0 auto; padding: 64px 32px 40px; }

.lh-trust__cta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  background: #1c1a17;
  border: 1px solid rgba(232, 146, 94, 0.28);
  border-radius: 12px;
  padding: 14px 18px;
  margin-bottom: 56px;
}
.lh-trust__cmd {
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 14px;
  color: #f0eee9;
  overflow-x: auto;
  white-space: nowrap;
}
.lh-trust__cmd .dollar { color: #e8925e; margin-right: 8px; }
.lh-trust__copy {
  font-size: 12px;
  font-weight: 600;
  color: #f0eee9;
  background: none;
  border: 1px solid rgba(240, 238, 233, 0.22);
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
}
.lh-trust__copy:hover { color: #e8925e; border-color: #e8925e; }
.lh-trust__cta-btn {
  margin-left: auto;
  font-size: 13px;
  font-weight: 700;
  padding: 9px 20px;
  border-radius: 8px;
  background: var(--va-accent, #c2410c);
  color: #ffffff;
  text-decoration: none;
}
.lh-trust__cta-btn:hover { background: #d9531e; }

.lh-sec-title { margin: 0 0 22px; font-size: 30px; font-weight: 800; color: #f0eee9; }
.lh-trust__evidence {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.lh-trust__ev {
  border: 1px solid rgba(240, 238, 233, 0.14);
  border-radius: 12px;
  padding: 14px 16px;
  text-decoration: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.15s;
}
.lh-trust__ev:hover { border-color: #e8925e; }
.lh-trust__ev-label { font-size: 14px; font-weight: 700; color: #f0eee9; }
.lh-trust__ev-note { font-size: 12px; color: rgba(240, 238, 233, 0.72); line-height: 1.6; }

.lh-trust__specs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin-top: 40px;
}
.lh-trust__spec {
  border: 1px solid rgba(240, 238, 233, 0.1);
  border-radius: 12px;
  padding: 14px 16px;
}
.lh-trust__spec-title { font-size: 13px; font-weight: 700; color: rgba(240, 238, 233, 0.9); }
.lh-trust__spec-desc { font-size: 12px; color: rgba(240, 238, 233, 0.72); line-height: 1.7; margin: 6px 0 0; }

.lh-trust__footer {
  margin-top: 48px;
  padding-top: 22px;
  border-top: 1px solid rgba(240, 238, 233, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.lh-trust__brand { font-size: 22px; font-weight: 800; color: #f0eee9; }
.lh-trust__brand .dot { color: var(--va-accent, #c2410c); }
.lh-trust__meta {
  font-size: 12px;
  color: rgba(240, 238, 233, 0.72);
  font-family: var(--va-font-mono, ui-monospace, monospace);
}
</style>
