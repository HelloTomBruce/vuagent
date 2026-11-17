<script setup lang="ts">
import { VaSkeleton } from "../../components/shimmer";
</script>

<template>
  <div class="va-agent-skeleton-chart" role="status" aria-label="图表加载中">
    <div class="va-agent-skel-chart-header">
      <VaSkeleton width="40%" height="16px" radius="4px" />
      <VaSkeleton width="50px" height="14px" radius="4px" />
    </div>
    <div class="va-agent-skel-chart-bars">
      <VaSkeleton width="20px" height="40px" radius="4px" />
      <VaSkeleton width="20px" height="75px" radius="4px" />
      <VaSkeleton width="20px" height="55px" radius="4px" />
      <VaSkeleton width="20px" height="90px" radius="4px" />
      <VaSkeleton width="20px" height="65px" radius="4px" />
      <VaSkeleton width="20px" height="80px" radius="4px" />
      <VaSkeleton width="20px" height="45px" radius="4px" />
    </div>
  </div>
</template>

<style scoped>
.va-agent-skeleton-chart {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.va-agent-skel-chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.va-agent-skel-chart-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 100px;
  padding: 10px 0;
  border-bottom: 1px solid var(--va-edge, rgba(26,25,23,0.1));
}
</style>
