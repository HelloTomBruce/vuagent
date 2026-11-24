<script setup lang="ts">
import { FileCode2, GitBranch, Rocket } from "lucide-vue-next";

const emit = defineEmits<{ (e: "quick", prompt: string): void }>();
</script>

<template>
  <div>
    <div class="host-banner">
      <h1>前端仓库 · 重构工作台</h1>
      <p>agent 生成重构预览：文件树 + 逐文件 diff + 变更摘要；「应用重构」属于高危写操作，会触发审批挂起，通过后自动落检查点（可随时回滚）。</p>
    </div>

    <div class="repo-card">
      <div class="repo-card__head">
        <GitBranch :size="14" />
        <span class="repo-card__branch">feat/order-service-refactor</span>
        <span class="repo-card__repo">acme/shop-monorepo</span>
      </div>
      <div class="repo-card__file">
        <FileCode2 :size="14" />
        <span>src/services/OrderService.ts</span>
        <span class="repo-card__loc">238 行 · 单体类（库存校验 / 价格计算 / 落库 / 事件 / 购物车全部内联）</span>
      </div>
    </div>

    <div class="flow">
      <div class="flow-step">
        <span class="flow-num">1</span>
        <div><b>生成重构预览</b><p>文件树 + 逐文件 diff 卡片，只读不落盘</p></div>
      </div>
      <div class="flow-step">
        <span class="flow-num">2</span>
        <div><b>跑验证测试</b><p>失败用例自动修复重跑，终端日志卡留痕</p></div>
      </div>
      <div class="flow-step">
        <span class="flow-num">3</span>
        <div><b>应用重构（审批）</b><p>高危写操作 → 安全引擎挂起 → 人工批准</p></div>
      </div>
      <div class="flow-step">
        <span class="flow-num">4</span>
        <div><b>检查点就绪</b><p>行上可预览 diff、一键触发回滚</p></div>
      </div>
    </div>

    <button class="cta" @click="emit('quick', '请调用 code_refactor_preview 工具，生成把 OrderService 拆分成领域子模块的重构预览')">
      <Rocket :size="13" /> 从「生成重构预览」开始体验
    </button>
  </div>
</template>

<style scoped>
.host-banner { margin-bottom: 14px; }
.host-banner h1 { font-size: 16px; margin: 0 0 4px; }
.host-banner p { font-size: 12px; color: var(--gv-muted); margin: 0; max-width: 660px; line-height: 1.6; }

.repo-card {
  background: #ffffff; border: 1px solid var(--gv-border);
  border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.repo-card__head { display: flex; align-items: center; gap: 8px; font-family: var(--va-font-mono, monospace); font-size: 12px; }
.repo-card__branch { color: var(--gv-accent); font-weight: 600; }
.repo-card__repo { color: var(--gv-muted); }
.repo-card__file { display: flex; align-items: center; gap: 8px; font-family: var(--va-font-mono, monospace); font-size: 12px; }
.repo-card__loc { color: var(--gv-muted); font-size: 11px; }

.flow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.flow-step {
  background: #ffffff; border: 1px solid var(--gv-border);
  border-radius: 10px; padding: 12px; display: flex; gap: 10px;
}
.flow-num {
  width: 22px; height: 22px; border-radius: 50%;
  background: #fff1e7; color: var(--gv-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; flex-shrink: 0;
}
.flow-step b { font-size: 12px; }
.flow-step p { font-size: 11px; color: var(--gv-muted); margin: 4px 0 0; line-height: 1.5; }

.cta {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--gv-accent); background: #fff1e7; color: var(--gv-accent);
  font-size: 12px; font-weight: 600; padding: 8px 14px; border-radius: 8px; cursor: pointer;
}
.cta:hover { background: #ffe4d1; }
</style>
