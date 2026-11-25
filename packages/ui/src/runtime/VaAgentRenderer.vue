<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AgentRendererProps } from "./types.js";
import { getAgentComponent } from "./registry.js";
import { postAgentAction } from "./actionClient.js";

const props = withDefaults(defineProps<AgentRendererProps>(), {
  readonly: false,
});

const emit = defineEmits<{
  (e: "submitAction", payload: unknown): void;
  /** 动作提交失败（网络异常 / HTTP 非 2xx / 宿主回调抛错） */
  (e: "error", error: Error): void;
}>();

const entry = computed(() => getAgentComponent(props.componentName));

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

// 统一封装交互回传
const handleAction = async (payload: unknown) => {
  if (props.apiBaseUrl) {
    try {
      await postAgentAction(props.apiBaseUrl, props.toolCallId, payload);
    } catch (err) {
      // 提交失败：emit error 并中止，不再走成功回传（避免宿主把失败误记为已决策）
      const error = toError(err);
      console.error("[VaAgentRenderer] Failed to submit action to API:", error);
      emit("error", error);
      return;
    }
  }

  // 避免同时触发 prop 回调与 emit 导致重复执行（Vue 3 中 @submit-action 会被识别为 onSubmitAction）
  try {
    if (props.onSubmitAction) {
      await props.onSubmitAction(payload);
    } else {
      emit("submitAction", payload);
    }
  } catch (err) {
    console.error("[VaAgentRenderer] onSubmitAction handler threw:", err);
    emit("error", toError(err));
  }
};

// 当前应该渲染的组件：根据状态、是否支持渐进渲染决定
// 骨架判定：streaming 且不支持渐进渲染且有骨架 → 渲染 skeleton（TASK-103 切换点）
const showSkeleton = computed(() => {
  if (!entry.value) return false;
  return props.status === "streaming" && !entry.value.progressive && Boolean(entry.value.skeleton);
});

const activeComponent = computed(() => {
  if (!entry.value) return null;
  return showSkeleton.value ? entry.value.skeleton : entry.value.component;
});

// 骨架 → 内容交叉过渡标记（motion.css「类切换重挂载」协议）：
// 仅当「渲染过骨架后切换到内容」时给内容节点挂 .va-crossfade（纯淡入，无位移），
// 历史回放等未经骨架直接渲染实体组件的场景不重复入场。
// watch 默认 pre flush：标记先于新节点渲染就位。skeleton 自身不接入场
// （其 shimmer 已是动效，避免双动画并发）；reduced-motion 由 motion.css 媒体块兜底。
const crossfadeContent = ref(false);
watch(showSkeleton, (now, before) => {
  crossfadeContent.value = Boolean(before && !now);
});

// 计算组件透传 Props
const activeProps = computed(() => {
  if (!entry.value) return {};
  // args 源自模型输出，运行时可能为 null/非对象，统一兜底为空对象再交给 propAdapter
  const args = props.args && typeof props.args === "object" ? props.args : {};
  if (entry.value.propAdapter) {
    return entry.value.propAdapter(args, {
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
    args,
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

    <!-- 匹配已注册组件 / 骨架屏（骨架→内容换节点时内容节点挂 .va-crossfade 纯淡入） -->
    <component
      :is="activeComponent"
      v-if="activeComponent"
      v-bind="activeProps"
      :class="crossfadeContent ? 'va-crossfade' : undefined"
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
