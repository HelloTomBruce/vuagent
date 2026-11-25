<script setup lang="ts">
import { User } from "lucide-vue-next";
import type { UserBubbleProps } from "./types";

const props = withDefaults(defineProps<UserBubbleProps>(), {
  content: "",
  attachments: () => [],
  avatar: "你",
  time: undefined,
});
</script>

<template>
  <!-- .va-enter-up（motion.css，180ms 上浮+fade）：组件挂载即一次性入场，
       reduced-motion 由 motion.css 媒体块降级为纯 fade -->
  <div class="va-user-bubble-row va-enter-up">
    <div class="va-user-bubble">
      <div class="va-user-bubble__body">
        <!-- 附件列表插槽或默认渲染 -->
        <slot name="attachments" :attachments="props.attachments">
          <div v-if="props.attachments?.length" class="va-user-bubble__atts">
            <template v-for="(att, idx) in props.attachments" :key="`${att.name}-${idx}`">
              <a
                v-if="att.kind === 'image' && (att.dataUrl || att.url)"
                :href="att.dataUrl || att.url"
                target="_blank"
                rel="noopener"
                class="va-user-bubble__att-img-link"
                :title="`${att.name}（点击查看原图）`"
              >
                <img :src="att.dataUrl || att.url" :alt="att.name" class="va-user-bubble__att-img" />
              </a>
              <span
                v-else
                class="va-user-bubble__att-chip"
                :title="att.size ? `${att.name} · ${att.size} B` : att.name"
              >
                📎 {{ att.name }}
              </span>
            </template>
          </div>
        </slot>

        <!-- 正文文本 -->
        <slot>
          <p class="va-user-bubble__text">{{ props.content }}</p>
        </slot>
      </div>

      <!-- 头像 -->
      <slot name="avatar">
        <div class="va-user-bubble__avatar">
          <img v-if="props.avatar && props.avatar.startsWith('http')" :src="props.avatar" alt="User" />
          <User v-else-if="props.avatar === 'icon'" :size="16" />
          <span v-else>{{ props.avatar || "你" }}</span>
        </div>
      </slot>
    </div>
  </div>
</template>

<style src="./VaUserBubble.css"></style>
