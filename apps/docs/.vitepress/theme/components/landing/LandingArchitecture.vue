<script setup lang="ts">
const packages = [
  {
    pkg: "@vuagent/protocol",
    title: "契约层",
    desc: "TypeBox Schema 单一事实来源：18 种 SSE 事件流、工具入参契约、组件生命周期——一份 Schema 同时充当模型参数、前端 Props 与运行时校验。",
    tag: "TypeBox",
  },
  {
    pkg: "@vuagent/server",
    title: "执行层",
    desc: "自研 Agent Harness：ReAct 循环、权限交集 + deny-wins 审批、执行与 HTTP 连接解耦（断线重连/多端订阅）、会话检查点与崩溃自愈。",
    tag: "Hono",
  },
  {
    pkg: "@vuagent/ui",
    title: "界面层",
    desc: "83 个强类型运行时组件 + 渲染分发器：SSE 事件流收敛为「文本 + 组件」混排流，npm 整包与 shadcn-vue 单文件拷贝双通道分发。",
    tag: "Vue 3.5",
  },
];
</script>

<template>
  <section class="lh-arch">
    <div class="lh-arch__inner">
      <h2 class="lh-sec-title">三包一条链路</h2>
      <p class="lh-sec-sub">链路上的每一个字段都出自 protocol——三端永远对着同一份 Schema 说话，杜绝双事实来源漂移。</p>
      <div class="lh-arch__row">
        <template v-for="(p, i) in packages" :key="p.pkg">
          <div class="lh-arch__card">
            <span class="lh-arch__pkg">{{ p.pkg }}</span>
            <div class="lh-arch__title">{{ p.title }}</div>
            <p class="lh-arch__desc">{{ p.desc }}</p>
            <span class="lh-arch__tag">{{ p.tag }}</span>
          </div>
          <div v-if="i < packages.length - 1" class="lh-arch__arrow" aria-hidden="true">→</div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-arch {
  /* 亮暗双主题：本地变量承载版块配色，.dark 祖先类翻转（与 tokens.css 的 .dark 块同机制） */
  --_bg: #f7f5f1;
  --_panel: #ffffff;
  --_ink: #1a1917;
  --_accent: #c2410c;
}
.dark .lh-arch {
  --_bg: #141311;
  --_panel: #1c1a17;
  --_ink: #f0eee9;
  --_accent: #e8925e;
}
.lh-arch {
  background: var(--_bg);
  border-top: 1px solid color-mix(in srgb, var(--_ink) 8%, transparent);
}
.lh-arch__inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 76px 32px;
}
.lh-sec-title {
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  color: var(--_ink);
}
.lh-sec-sub {
  margin: 12px 0 0;
  font-size: 16px;
  color: color-mix(in srgb, var(--_ink) 72%, transparent);
  max-width: 760px;
  line-height: 1.8;
}
.lh-arch__row {
  display: flex;
  align-items: stretch;
  margin-top: 40px;
}
.lh-arch__card {
  flex: 1;
  background: var(--_panel);
  border: 1px solid color-mix(in srgb, var(--_ink) 14%, transparent);
  border-radius: 16px;
  padding: 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lh-arch__card:hover { border-color: color-mix(in srgb, var(--_accent) 40%, transparent); }
.lh-arch__pkg {
  width: fit-content;
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 13px;
  font-weight: 700;
  color: var(--_accent);
  background: color-mix(in srgb, var(--_accent) 10%, transparent);
  border-radius: 999px;
  padding: 4px 13px;
}
.lh-arch__title { font-size: 26px; font-weight: 700; color: var(--_ink); }
.lh-arch__desc { font-size: 14px; color: color-mix(in srgb, var(--_ink) 72%, transparent); line-height: 1.8; flex: 1; }
.lh-arch__tag {
  width: fit-content;
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in srgb, var(--_ink) 72%, transparent);
  border: 1px solid color-mix(in srgb, var(--_ink) 20%, transparent);
  border-radius: 6px;
  padding: 2px 9px;
}
.lh-arch__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  color: var(--_accent);
  font-size: 28px;
  font-weight: 700;
}
@media (max-width: 960px) {
  .lh-arch__row { flex-direction: column; gap: 12px; }
  .lh-arch__arrow { transform: rotate(90deg); width: auto; height: 30px; }
}
</style>
