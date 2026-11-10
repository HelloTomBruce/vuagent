<script setup lang="ts">
import type { MessageTextProps } from "./types";

defineProps<MessageTextProps>();
</script>

<template>
  <div class="va-msg-text">
    <Transition name="va-msg-text" mode="out-in">
      <div :key="version" class="va-msg-text__inner" dir="auto">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style src="./VaMessageText.css"></style>
