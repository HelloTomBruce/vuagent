<script setup lang="ts">
import { computed } from "vue";
import type { AgentRendererProps } from "./types.js";
import { getAgentComponent } from "./registry.js";

const props = withDefaults(defineProps<AgentRendererProps>(), {
  readonly: false,
});

const emit = defineEmits<{
  (e: "submitAction", payload: any): void;
}>();

const entry = computed(() => getAgentComponent(props.componentName));

// 统一封装交互回传
const handleAction = async (payload: any) => {
  if (props.apiBaseUrl) {
    try {
      await fetch(`${props.apiBaseUrl}/api/action/${props.toolCallId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[VaAgentRenderer] Failed to submit action to API:", err);
    }
  }

  // 避免同时触发 prop 回调与 emit 导致重复执行（Vue 3 中 @submit-action 会被识别为 onSubmitAction）
  if (props.onSubmitAction) {
    await props.onSubmitAction(payload);
  } else {
    emit("submitAction", payload);
  }
};

// 当前应该渲染的组件：根据状态、是否支持渐进渲染决定
const activeComponent = computed(() => {
  if (!entry.value) return null;
  if (props.status === "streaming" && !entry.value.progressive && entry.value.skeleton) {
    return entry.value.skeleton;
  }
  return entry.value.component;
});

// 计算组件透传 Props
const activeProps = computed(() => {
  if (!entry.value) return {};
  if (entry.value.propAdapter) {
    return entry.value.propAdapter(props.args, {
      toolCallId: props.toolCallId,
      status: props.status,
      result: props.result,
      onSubmitAction: handleAction,
    });
  }
  return {
    toolCallId: props.toolCallId,
    componentName: props.componentName,
    status: props.status,
    args: props.args,
    result: props.result,
    error: props.error,
    readonly: props.readonly,
    onSubmitAction: handleAction,
  };
});
</script>

<template>
  <div class="va-agent-renderer" :data-status="status">
    <!-- 状态指示徽章 -->
    <div :class="['va-agent-renderer-badge', status]">
      {{ status }}
    </div>

    <!-- 匹配已注册组件 / 骨架屏 -->
    <component
      :is="activeComponent"
      v-if="activeComponent"
      v-bind="activeProps"
    />

    <!-- 兜底：未注册组件 -->
    <div v-else class="va-agent-fallback">
      <div class="va-agent-fallback-head">
        <span>未知组件: {{ componentName }}</span>
        <span>({{ status }})</span>
      </div>
      <pre class="va-agent-fallback-code">{{ JSON.stringify(args, null, 2) }}</pre>
    </div>
  </div>
</template>

<style src="./VaAgentRenderer.css"></style>
