<script setup lang="ts">
import { computed } from "vue";
import { Brain, CheckCircle2, ChevronDown, ChevronUp } from "lucide-vue-next";
import type { ThoughtBoxEvents, ThoughtBoxProps } from "./types";

const props = withDefaults(defineProps<ThoughtBoxProps>(), {
  thought: "",
  expanded: true,
  duration: undefined,
  streaming: false,
  summaryMode: false,
  toolCount: 0,
});

const emit = defineEmits<ThoughtBoxEvents>();

const isExpanded = computed({
  get: () => props.expanded,
  set: (val) => {
    emit("update:expanded", val);
    emit("toggle", val);
  },
});

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

function expandFromSummary() {
  emit("update:summaryMode", false);
  emit("update:expanded", true);
  emit("toggle", true);
}
</script>

<template>
  <!-- 1. 摘要条展示模式 -->
  <button
    v-if="props.summaryMode"
    class="va-thought-box__summary"
    type="button"
    title="展开过程详情"
    @click="expandFromSummary"
  >
    <CheckCircle2 :size="14" class="va-thought-box__summary-icon" />
    <span>
      已完成<template v-if="props.duration != null"> · 耗时 {{ props.duration }}s</template><template v-if="props.toolCount"> · {{ props.toolCount }} 次工具调用</template>
    </span>
    <ChevronDown :size="13" class="va-thought-box__summary-chevron" />
  </button>

  <!-- 2. 详细思考展开盒 -->
  <div v-else class="va-thought-box">
    <div class="va-thought-box__header" @click="toggleExpanded">
      <div class="va-thought-box__title">
        <Brain :size="15" :class="{ 'va-thought-box__pulse-icon': props.streaming }" />
        <span>思考过程</span>
        <span v-if="props.duration != null" class="va-thought-box__duration">· 耗时 {{ props.duration }}s</span>
        <span v-else-if="props.streaming" class="va-thought-box__duration">· 正在深度思考…</span>
      </div>
      <button class="va-thought-box__btn" type="button" @click.stop="toggleExpanded">
        {{ isExpanded ? "收起" : "展开" }}
        <ChevronUp v-if="isExpanded" :size="13" />
        <ChevronDown v-else :size="13" />
      </button>
    </div>

    <div v-if="isExpanded" class="va-thought-box__content">
      <slot>
        {{ props.thought || (props.streaming ? "正在拆解任务意图，规划工具调用序列与沙箱执行路径…" : "暂无思考内容") }}
      </slot>
    </div>
  </div>
</template>

<style src="./VaThoughtBox.css"></style>
