<script setup lang="ts">
import { ref } from "vue";
import { VaButton, VaNumberTicker, VaShimmerText, VaSkeleton } from "@vuagent/ui";

const loading = ref(false);
const amount = ref(48240);
const tickerKey = ref(0);

function fakeSubmit() {
  loading.value = true;
  window.setTimeout(() => (loading.value = false), 2000);
}

function replay() {
  amount.value = Math.round(1000 + Math.random() * 90000);
  tickerKey.value++;
}
</script>

<template>
  <div class="m1">
    <h2>VaButton · 四变体 × 三尺寸 + 加载态</h2>
    <div class="card">
      <div class="row">
        <VaButton>主要操作</VaButton>
        <VaButton variant="secondary">次要操作</VaButton>
        <VaButton variant="ghost">幽灵按钮</VaButton>
        <VaButton variant="destructive">删除</VaButton>
      </div>
      <div class="row">
        <VaButton size="sm">小</VaButton>
        <VaButton size="md">中</VaButton>
        <VaButton size="lg">大</VaButton>
        <VaButton variant="secondary" :loading="loading" @click="fakeSubmit">
          {{ loading ? "提交中…" : "点我加载态" }}
        </VaButton>
        <VaButton variant="primary" disabled>禁用</VaButton>
      </div>
    </div>

    <h2>VaSkeleton / VaShimmerText · 共享一道扫光</h2>
    <div class="card">
      <VaSkeleton width="70%" height="14" />
      <VaSkeleton width="90%" height="14" />
      <VaSkeleton width="45%" height="14" />
      <div class="row">
        <VaSkeleton width="44" height="44" circle />
        <VaShimmerText>正在思考下一步…</VaShimmerText>
      </div>
    </div>

    <h2>VaNumberTicker · 里程表滚动（重播 = 换随机值）</h2>
    <div class="card">
      <div class="big-num">
        <VaNumberTicker :key="tickerKey" :value="amount" :format="{ maximumFractionDigits: 0 }" />
      </div>
      <div class="row">
        <VaNumberTicker
          :key="`${tickerKey}-usd`"
          :value="amount"
          :format="{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }"
        />
      </div>
      <div><VaButton variant="secondary" size="sm" @click="replay">↻ 换个数字滚一下</VaButton></div>
    </div>
  </div>
</template>

<style scoped>
.m1 h2 { margin: 28px 0 12px; font-size: 15px; }
.m1 h2:first-child { margin-top: 0; }
.card {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.big-num { font-size: 34px; font-weight: 800; }
</style>
