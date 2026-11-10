<script setup lang="ts">
import { ref } from "vue";
import {
  VaButton,
  VaComposer,
  VaGridBackground,
  VaMessageActions,
  VaMessageText,
  VaModelPicker,
  VaSegmentedControl,
  VaStreamAnswer,
  VaTextReveal,
  VaThinkingLoader,
  VaToaster,
  vaToaster,
} from "@vuagent/ui";

/* 分段控件 */
const seg = ref("free");

/* 模型选择 + 输入框 + 流式回答 */
const model = ref("claude");
const draft = ref("");
const answerSource = "已按你的要求把 Hero 标题改为逐词浮现，并为暗色模式补齐了对比度。\n改动共涉及 2 个文件，构建通过。";
const answerKey = ref(0);

function send(text: string) {
  vaToaster.add({ title: "任务已提交", description: text.slice(0, 40), kind: "success" });
  draft.value = "";
  answerKey.value++;
}

/* 消息操作 */
const msgVersions = ref(["affectUI 的每个组件都是一个自包含文件。", "affectUI 的每个组件都是单个自包含文件，样式内嵌、零依赖。"]);
const msgVersion = ref(0);
const regenerating = ref(false);
function regenerate() {
  regenerating.value = true;
  window.setTimeout(() => {
    msgVersions.value = [...msgVersions.value, `${msgVersions.value[msgVersions.value.length - 1]}（已再生成）`];
    msgVersion.value = msgVersions.value.length - 1;
    regenerating.value = false;
  }, 900);
}
</script>

<template>
  <div class="m3">
    <VaToaster />
    <div class="m3__grid">
      <section class="m3__panel">
        <h3>Segmented Control</h3>
        <VaSegmentedControl
          v-model="seg"
          full-width
          aria-label="筛选"
          :options="[
            { value: 'all', label: '全部 22' },
            { value: 'free', label: '免费 22' },
            { value: 'pro', label: 'Pro 0', disabled: true },
          ]"
        />
        <p class="m3__note">当前：{{ seg }}</p>
      </section>

      <section class="m3__panel">
        <h3>Toaster</h3>
        <div class="m3__row">
          <VaButton size="sm" @click="vaToaster.add({ title: '组件已安装', description: 'approval-card → components/ui', kind: 'success' })">成功通知</VaButton>
          <VaButton size="sm" variant="secondary" @click="vaToaster.add({ title: '需要审批', description: 'pnpm add -D vitest', kind: 'warning' })">警告通知</VaButton>
          <VaButton size="sm" variant="destructive" @click="vaToaster.add({ title: '构建失败', kind: 'danger' })">错误通知</VaButton>
        </div>
      </section>

      <section class="m3__panel">
        <h3>Text Reveal + Grid Background</h3>
        <VaGridBackground :size="36" :speed="2" style="border-radius: 12px; padding: 18px">
          <VaTextReveal as="p" by="word" :stagger="70" text="为 AI 产品而生的 Agent Ops 组件库" style="font-size: 17px; font-weight: 700" />
        </VaGridBackground>
      </section>

      <section class="m3__panel">
        <h3>Thinking Loader</h3>
        <div class="m3__row" style="flex-wrap: wrap">
          <VaThinkingLoader :phases="['读取文件', '修改组件', '运行构建']" loop />
          <VaThinkingLoader done done-label="已完成 · 4.2s" />
        </div>
      </section>

      <section class="m3__panel">
        <h3>Composer + Model Picker + Stream Answer</h3>
        <VaStreamAnswer :key="answerKey" :source="answerSource" style="margin-bottom: 12px" />
        <VaComposer v-model:text="draft" @send="send">
          <template #prefix>
            <VaModelPicker v-model:selected="model" />
          </template>
        </VaComposer>
        <p class="m3__note">模型：{{ model }} · 输入后回车发送 → 右下角通知 + 上方回答重放</p>
      </section>

      <section class="m3__panel">
        <h3>Message Actions / Text</h3>
        <VaMessageText :version="msgVersion">{{ msgVersions[msgVersion] }}</VaMessageText>
        <div style="margin-top: 10px">
          <VaMessageActions
            v-model:version="msgVersion"
            :text="msgVersions[msgVersion]"
            :versions="msgVersions.length"
            :regenerating="regenerating"
            quiet
            @regenerate="regenerate"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.m3__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; align-items: start; }
.m3__panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  min-width: 0;
}
.m3__panel h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--va-muted, #6f6d66);
}
.m3__row { display: flex; gap: 10px; align-items: center; }
.m3__note { margin: 8px 0 0; font-size: 12px; color: var(--va-muted, #6f6d66); }
</style>
