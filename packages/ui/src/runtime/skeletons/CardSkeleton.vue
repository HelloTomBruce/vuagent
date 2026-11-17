<script setup lang="ts">
import { VaSkeleton } from "../../components/shimmer";

defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="va-agent-skeleton-card" role="status" aria-label="组件加载中">
    <div class="va-agent-skel-header">
      <VaSkeleton width="35%" height="16px" radius="4px" />
      <VaSkeleton width="48px" height="20px" radius="10px" />
    </div>
    <div class="va-agent-skel-body">
      <VaSkeleton width="90%" height="12px" radius="3px" />
      <VaSkeleton width="75%" height="12px" radius="3px" />
      <VaSkeleton width="60%" height="12px" radius="3px" />
    </div>
    <div class="va-agent-skel-footer">
      <VaSkeleton width="70px" height="28px" radius="6px" />
      <VaSkeleton width="80px" height="28px" radius="6px" />
    </div>
  </div>
</template>

<style scoped>
.va-agent-skeleton-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.va-agent-skel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.va-agent-skel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.va-agent-skel-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
