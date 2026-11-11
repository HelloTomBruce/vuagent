<script setup lang="ts">
import type { EmailDraftEvents, EmailDraftProps } from "./types";

const props = defineProps<EmailDraftProps>();

const emit = defineEmits<EmailDraftEvents>();

function send() {
  if (props.sending) return;
  emit("send", {
    to: props.to ?? "",
    subject: props.subject ?? "",
    body: props.body ?? "",
    tone: props.tone,
  });
}

/** 内容为空判定（drafting 态发送按钮一律禁用） */
const empty = () => !(props.body ?? "").trim() || !(props.subject ?? "").trim() || !(props.to ?? "").trim();
</script>

<template>
  <form class="va-mail" @submit.prevent="send">
    <header class="va-mail__head">
      <span class="va-mail__title">邮件草稿</span>
      <span class="va-mail__badge">Agent 起草 · 人工确认</span>
      <span class="va-mail__spacer" />
      <button class="va-btn va-btn--sm va-mail__regen" type="button" :disabled="props.drafting" @click="emit('regenerate')">
        重新起草
      </button>
    </header>

    <div class="va-mail__fields">
      <!-- 起草中骨架 -->
      <template v-if="props.drafting">
        <div class="va-mail__skel va-mail__skel--to" />
        <div class="va-mail__skel va-mail__skel--subject" />
        <div class="va-mail__skel va-mail__skel--body" />
      </template>
      <template v-else>
        <label class="va-mail__field">
          <span class="va-mail__label">收件人</span>
          <input
            class="va-mail__input"
            type="text"
            :value="props.to"
            placeholder="name@example.com"
            @input="emit('update:to', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="va-mail__field">
          <span class="va-mail__label">主题</span>
          <input
            class="va-mail__input"
            type="text"
            :value="props.subject"
            placeholder="邮件主题"
            @input="emit('update:subject', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <div v-if="props.tones?.length" class="va-mail__tones" role="radiogroup" aria-label="语气">
          <button
            v-for="t in props.tones"
            :key="t.value"
            class="va-mail__tone"
            type="button"
            role="radio"
            :aria-checked="props.tone === t.value"
            :data-active="props.tone === t.value"
            @click="emit('update:tone', t.value)"
          >{{ t.label }}</button>
        </div>
        <label class="va-mail__field va-mail__field--body">
          <span class="va-mail__label">正文</span>
          <textarea
            class="va-mail__input va-mail__body"
            rows="7"
            :value="props.body"
            placeholder="agent 将在这里生成草稿，你可以直接修改…"
            @input="emit('update:body', ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </template>
    </div>

    <footer class="va-mail__foot">
      <p v-if="props.error" class="va-mail__error" role="alert">{{ props.error }}</p>
      <span v-else class="va-mail__hint">发送前请核对收件人与内容</span>
      <span class="va-mail__spacer" />
      <button
        class="va-btn va-btn--primary va-mail__send"
        type="submit"
        :disabled="props.sending || props.drafting || empty()"
      >{{ props.sending ? "发送中…" : "发送" }}</button>
    </footer>
  </form>
</template>

<style src="./VaEmailDraft.css"></style>
