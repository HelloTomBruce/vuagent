<script setup lang="ts">
import type { MessageActionsProps } from "./types";
import { useMessageActions } from "./useMessageActions";

const props = withDefaults(defineProps<MessageActionsProps>(), {
  text: undefined,
  versions: undefined,
  regenerating: false,
  quiet: false,
  reasons: undefined,
});

const emit = defineEmits<{
  copy: [text?: string];
  regenerate: [];
  versionChange: [index: number];
  feedback: [kind: null | "up" | "down", reason?: string];
}>();

const version = defineModel<number>("version");

const {
  copied,
  copy,
  chosen,
  panelOpen,
  reasons,
  customReason,
  thumb,
  sendDown,
  takeBack,
  count,
  effective,
  showVersions,
  go,
} = useMessageActions(props, version, {
  copy: (t) => emit("copy", t),
  regenerate: () => emit("regenerate"),
  versionChange: (i) => emit("versionChange", i),
  feedback: (kind, reason) => emit("feedback", kind, reason),
});
</script>

<template>
  <div class="va-msg" :class="{ 'va-msg--quiet': props.quiet, 'va-msg--panel': panelOpen }">
    <div class="va-msg__bar">
      <!-- 复制 -->
      <button class="va-msg__act" type="button" :aria-label="copied ? '已复制' : '复制'" @click="copy">
        <svg v-if="copied" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5.5 12.5l4 4L18.5 8" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5zM15 8V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H9" /></svg>
      </button>

      <!-- 再生成 -->
      <button class="va-msg__act" type="button" :aria-label="props.regenerating ? '再生成中' : '再生成'" @click="emit('regenerate')">
        <svg :class="{ 'va-msg__spin': props.regenerating }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9M19.5 4.5V9H15" /></svg>
      </button>

      <!-- 版本切换 -->
      <span v-if="showVersions" class="va-msg__versions">
        <button class="va-msg__act" type="button" aria-label="上一版本" :disabled="effective <= 0" @click="go(-1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m14.5 7-5 5 5 5" /></svg>
        </button>
        <span class="va-msg__ver-label">{{ effective + 1 }} / {{ count }}</span>
        <button class="va-msg__act" type="button" aria-label="下一版本" :disabled="effective >= count - 1" @click="go(1)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9.5 7 5 5-5 5" /></svg>
        </button>
      </span>

      <span class="va-msg__sep" aria-hidden="true" />

      <!-- 反馈 -->
      <button
        class="va-msg__act"
        :class="{ 'va-msg__act--on': chosen === 'up' }"
        type="button"
        aria-label="赞"
        :aria-pressed="chosen === 'up'"
        @click="thumb('up')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 10.5v9M7.5 10.5l3.3-6a1.8 1.8 0 0 1 3.3 1.2l-.6 3.8H18a2 2 0 0 1 2 2.3l-1.2 6.4a2 2 0 0 1-2 1.8H5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z" /></svg>
      </button>
      <button
        class="va-msg__act"
        :class="{ 'va-msg__act--on': chosen === 'down' }"
        type="button"
        aria-label="踩"
        :aria-pressed="chosen === 'down'"
        @click="thumb('down')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform: rotate(180deg)"><path d="M7.5 10.5v9M7.5 10.5l3.3-6a1.8 1.8 0 0 1 3.3 1.2l-.6 3.8H18a2 2 0 0 1 2 2.3l-1.2 6.4a2 2 0 0 1-2 1.8H5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z" /></svg>
      </button>
    </div>

    <!-- 点踩原因面板 -->
    <Transition name="va-msg-panel">
      <div v-if="panelOpen" class="va-msg__panel">
        <p class="va-msg__panel-title">哪里不满意？</p>
        <div class="va-msg__reasons">
          <button v-for="r in reasons" :key="r" class="va-msg__reason" type="button" @click="sendDown(r)">{{ r }}</button>
        </div>
        <div class="va-msg__other">
          <input v-model="customReason" class="va-msg__other-input" type="text" placeholder="其他原因…" @keydown.enter="sendDown(customReason)" />
          <button class="va-msg__reason va-msg__reason--go" type="button" :disabled="!customReason.trim()" @click="sendDown(customReason)">发送</button>
          <button class="va-msg__reason" type="button" @click="takeBack">撤回反馈</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style src="./VaMessageActions.css"></style>
