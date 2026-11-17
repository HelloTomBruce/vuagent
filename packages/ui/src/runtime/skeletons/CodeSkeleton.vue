<script setup lang="ts">
import { VaSkeleton } from "../../components/shimmer";
</script>

<template>
  <div class="va-agent-skeleton-code" role="status" aria-label="代码块加载中">
    <div class="va-agent-skel-code-bar">
      <VaSkeleton width="120px" height="14px" radius="3px" />
      <VaSkeleton width="40px" height="18px" radius="4px" />
    </div>
    <div class="va-agent-skel-code-lines">
      <VaSkeleton width="85%" height="11px" radius="2px" />
      <VaSkeleton width="60%" height="11px" radius="2px" />
      <VaSkeleton width="92%" height="11px" radius="2px" />
      <VaSkeleton width="45%" height="11px" radius="2px" />
      <VaSkeleton width="70%" height="11px" radius="2px" />
    </div>
  </div>
</template>

<style scoped>
.va-agent-skeleton-code {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--va-bg-subtle, #efede7);
  border-radius: 8px;
}
.va-agent-skel-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--va-edge, rgba(26,25,23,0.1));
  padding-bottom: 8px;
}
.va-agent-skel-code-lines {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
</style>
