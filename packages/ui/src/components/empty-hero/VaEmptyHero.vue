<script setup lang="ts">
import { FolderClosed, Plus, Sparkles } from "lucide-vue-next";
import type { EmptyHeroEvents, EmptyHeroProps } from "./types";

const props = withDefaults(defineProps<EmptyHeroProps>(), {
  workspaces: () => [],
  creating: false,
  title: "开始一个任务",
  description: "选择一个工作区开启会话；agent 的文件读写都限定在其目录内。",
});

const emit = defineEmits<EmptyHeroEvents>();
</script>

<template>
  <!-- .va-enter-up（motion.css，180ms 上浮+fade）：空态 hero 挂载即一次性入场；
       reduced-motion 由 motion.css 媒体块降级为纯 fade。 -->
  <div class="va-hero va-enter-up">
    <div class="va-hero__badge" aria-hidden="true">
      <slot name="icon">
        <Sparkles :size="20" class="va-hero__icon" />
      </slot>
    </div>
    <h3 class="va-hero__title">{{ props.title }}</h3>
    <p class="va-hero__desc">{{ props.description }}</p>
    <div class="va-hero__cards">
      <button
        v-for="w in props.workspaces"
        :key="w.id"
        class="va-hero__card"
        type="button"
        :disabled="props.creating"
        :title="w.path || w.name"
        @click="emit('createSession', w.id)"
      >
        <FolderClosed :size="18" aria-hidden="true" />
        <span class="va-hero__card-name">{{ w.name }}</span>
        <span v-if="w.path" class="va-hero__card-path">{{ w.path }}</span>
      </button>
      <button class="va-hero__card va-hero__card--new" type="button" :disabled="props.creating" @click="emit('createWorkspace')">
        <Plus :size="18" aria-hidden="true" />
        <span class="va-hero__card-name">新建工作区</span>
        <span class="va-hero__card-path">弹出系统文件夹选择框</span>
      </button>
    </div>
  </div>
</template>

<style src="./VaEmptyHero.css"></style>
