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
    desc: "79 个强类型运行时组件 + 渲染分发器：SSE 事件流收敛为「文本 + 组件」混排流，npm 整包与 shadcn-vue 单文件拷贝双通道分发。",
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
  background: #141311;
  border-top: 1px solid rgba(240, 238, 233, 0.08);
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
  color: #f0eee9;
}
.lh-sec-sub {
  margin: 12px 0 0;
  font-size: 16px;
  color: rgba(240, 238, 233, 0.72);
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
  background: #1c1a17;
  border: 1px solid rgba(240, 238, 233, 0.14);
  border-radius: 16px;
  padding: 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lh-arch__card:hover { border-color: rgba(232, 146, 94, 0.4); }
.lh-arch__pkg {
  width: fit-content;
  font-family: var(--va-font-mono, ui-monospace, monospace);
  font-size: 13px;
  font-weight: 700;
  color: #e8925e;
  background: rgba(232, 146, 94, 0.1);
  border-radius: 999px;
  padding: 4px 13px;
}
.lh-arch__title { font-size: 26px; font-weight: 700; color: #f0eee9; }
.lh-arch__desc { font-size: 14px; color: rgba(240, 238, 233, 0.72); line-height: 1.8; flex: 1; }
.lh-arch__tag {
  width: fit-content;
  font-size: 11px;
  font-weight: 600;
  color: rgba(240, 238, 233, 0.72);
  border: 1px solid rgba(240, 238, 233, 0.2);
  border-radius: 6px;
  padding: 2px 9px;
}
.lh-arch__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  color: #e8925e;
  font-size: 28px;
  font-weight: 700;
}
@media (max-width: 960px) {
  .lh-arch__row { flex-direction: column; gap: 12px; }
  .lh-arch__arrow { transform: rotate(90deg); width: auto; height: 30px; }
}
</style>
