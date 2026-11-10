<script setup lang="ts">
import { ref } from "vue";
import { VaButton, VaNumberTicker, VaShimmerText, VaSkeleton } from "@vuagent/ui";
import AgentRunDemo from "./AgentRunDemo.vue";
import M3Demo from "./M3Demo.vue";
import M5Demo from "./M5Demo.vue";
import M6Demo from "./M6Demo.vue";
import Gallery from "./Gallery.vue";

const theme = ref<"light" | "dark">("light");
const loading = ref(false);
const amount = ref(48240);
const tickerKey = ref(0);

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme.value;
}

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
  <div class="wrap">
    <header class="topbar">
      <span class="brand"><span class="dot" />Vuagent <small>M1 打样 · Calm</small></span>
      <VaButton variant="secondary" size="sm" @click="toggleTheme">
        {{ theme === "light" ? "🌙 暗色" : "☀️ 亮色" }}
      </VaButton>
    </header>

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

    <h2>Agent 运行页雏形 · 旗舰组件编排</h2>
    <AgentRunDemo />

    <h2>M3 新组件 · Chat 配套与基础动效</h2>
    <M3Demo />

    <h2>M5 · Agent 客户端刚需批（diff / 文件树 / 终端 / 检查点 / ⌘K …）</h2>
    <M5Demo />

    <h2>M6 · 输入·表单·导航·反馈批（向导 / 集成 / 通知 / 日期范围 …）</h2>
    <M6Demo />

    <h2>组件画廊 · 视觉走查</h2>
    <Gallery />
  </div>
</template>
