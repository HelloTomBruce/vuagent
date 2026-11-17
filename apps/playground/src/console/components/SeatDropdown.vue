<script setup lang="ts">
/**
 * 通用座位区下拉（Composer 工具栏）
 * 自管理开合 + 全局点击外部自动收起（与原 closeAllMenus 行为等价：
 * 打开另一个下拉时，本下拉因外部点击而关闭）
 */
import { onMounted, onUnmounted, ref } from "vue";

const open = ref(false);

function toggle() {
  open.value = !open.value;
}

function onDocClick() {
  open.value = false;
}

onMounted(() => window.addEventListener("click", onDocClick));
onUnmounted(() => window.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="va-console__dropdown-wrap" @click.stop>
    <button class="va-console__seat-btn" type="button" @click="toggle">
      <slot name="trigger" />
    </button>

    <div v-if="open" class="va-console__dropdown-menu">
      <slot />
    </div>
  </div>
</template>
