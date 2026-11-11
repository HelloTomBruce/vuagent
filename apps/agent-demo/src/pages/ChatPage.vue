<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  VaAiAnswer,
  VaApprovalCard,
  VaComposer,
  VaMessageActions,
  VaModelPicker,
  VaReactionBar,
  VaSmartRecommendation,
  VaThinkingLoader,
  VaToolCallCard,
  VaToolCallGroup,
  vaToaster,
} from "@vuagent/ui";
import { useAgentEngine } from "../engine/useAgentEngine";
import type { AgentMessage } from "../engine/types";

const { state, dispatch, decideApproval } = useAgentEngine();

const draft = ref("");
const streamEl = ref<HTMLElement | null>(null);
const stick = ref(true);

/* PromptLibrary「使用」→ 填入输入框 */
watch(
  () => state.promptDraft,
  (v) => {
    if (v) {
      draft.value = v;
      state.promptDraft = "";
    }
  },
);

/* 贴底滚动 */
function onScroll() {
  const el = streamEl.value;
  if (!el) return;
  stick.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
}
watch(
  () => state.messages.length,
  () => {
    if (!stick.value) return;
    nextTick(() => {
      const el = streamEl.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
);

function send(text: string) {
  if (state.busy) return;
  void dispatch(text);
}

/* answer 消息的反馈 */
const reaction = ref<Record<string, string>>({});
function onReact(msgId: string, id: string) {
  reaction.value = { ...reaction.value, [msgId]: id };
  vaToaster.add({ title: id === "up" ? "感谢反馈" : "已记录，会继续改进", kind: "success" });
}

const messages = computed(() => state.messages as AgentMessage[]);
const timeOf = (m: { at: number }) => new Date(m.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <div class="chat-page">
    <div ref="streamEl" class="chat-stream" @scroll="onScroll">
      <template v-for="m in messages" :key="m.id">
        <!-- 用户 -->
        <div v-if="m.role === 'user'" class="msg msg--user">
          <div class="bubble bubble--user">{{ m.text }}</div>
          <span class="msg-time">{{ timeOf(m) }}</span>
        </div>

        <!-- 思考态 -->
        <div v-else-if="m.kind === 'thinking'" class="msg">
          <VaThinkingLoader :phases="[m.label]" loop />
        </div>

        <!-- 工具调用组 -->
        <div v-else-if="m.kind === 'tools'" class="msg">
          <VaToolCallGroup>
            <VaToolCallCard
              v-for="(c, i) in m.calls"
              :key="i"
              :name="c.name"
              :summary="c.summary"
              :status="c.status"
              :result="c.result"
              :duration="c.status === 'success' ? c.ms : undefined"
            />
          </VaToolCallGroup>
        </div>

        <!-- 引用回答 -->
        <div v-else-if="m.kind === 'answer'" class="msg">
          <VaAiAnswer :answer="m.text" :sources="m.sources" @source="(s) => vaToaster.add({ title: `来源：${s.title}`, description: s.origin })" />
          <div class="msg-ops">
            <VaMessageActions :text="m.text" @copy="() => {}" />
            <VaReactionBar
              :reactions="[
                { id: 'up', emoji: '👍', label: '有帮助', active: reaction[m.id] === 'up' },
                { id: 'down', emoji: '👎', active: reaction[m.id] === 'down' },
              ]"
              @toggle="(item) => onReact(m.id, item.id)"
            />
          </div>
        </div>

        <!-- 建议 -->
        <VaSmartRecommendation
          v-else-if="m.kind === 'recommend'"
          class="msg"
          :title="m.title"
          :description="m.description"
          :impact="m.impact"
          :actions="[
            { id: 'apply', label: '开启', primary: true },
            { id: 'later', label: '暂不' },
          ]"
          @action="(id) => vaToaster.add({ title: id === 'apply' ? `已${m.title}` : '已忽略', kind: id === 'apply' ? 'success' : 'info' })"
        />

        <!-- 纯文本 -->
        <div v-else class="msg">
          <div class="bubble">{{ m.text }}</div>
        </div>
      </template>

      <!-- 审批门 -->
      <div v-if="state.pendingApproval" class="msg">
        <VaApprovalCard
          :title="state.pendingApproval.title"
          :preview="state.pendingApproval.preview"
          :risk="state.pendingApproval.risk"
          :countdown="state.pendingApproval.countdown"
          @approve="decideApproval(true)"
          @deny="decideApproval(false)"
        />
      </div>
    </div>

    <footer class="chat-foot">
      <VaComposer
        v-model:text="draft"
        :busy="state.busy"
        placeholder="试试：生成周报 / 重构用户列表页 / 分析任务数据…"
        @send="send"
      >
        <template #prefix>
          <VaModelPicker v-model:selected="state.model" />
        </template>
      </VaComposer>
    </footer>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 860px;
  margin: 0 auto;
}

.chat-stream {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; max-width: 92%; }
.msg--user { align-items: flex-end; align-self: flex-end; }

.bubble {
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble--user { background: var(--va-ink); color: var(--va-card); border-top-right-radius: 4px; }
.msg > .bubble { background: var(--va-card); border: 1px solid var(--va-edge); border-top-left-radius: 4px; }

.msg-time { font-size: 11px; color: var(--va-muted); }

.msg-ops { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

.chat-foot {
  padding: 12px 0 4px;
  border-top: 1px solid var(--va-edge);
}
</style>
