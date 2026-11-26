<script setup lang="ts">
import { computed, ref } from "vue";
import { Bot, ChevronDown, Sparkles, X } from "lucide-vue-next";
import {
  VaComposer,
  VaApprovalCard,
  VaForm,
  VaUserBubble,
  VaAssistantTurn,
  getCardComponent,
} from "@vuagent/ui";
import { SCENES } from "./scenes";
import { useAgentChat } from "./composables/useAgentChat";

const activeSceneId = ref(SCENES[0].id);
const activeScene = computed(() => SCENES.find((s) => s.id === activeSceneId.value)!);

const chat = useAgentChat({ greeting: SCENES[0].greeting });

function switchScene(id: string) {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) return;
  activeSceneId.value = id;
  chat.switchScene(id, scene.greeting);
}

const isDrawerOpen = ref(true);
</script>

<template>
  <div class="gv-topbar">
    <div class="gv-brand">
      <Sparkles :size="16" style="color: var(--gv-accent)" />
      <span>Agent 场景画廊</span>
      <span class="gv-brand__tag">vuagent examples · 3 场景</span>
    </div>
    <div class="gv-tabs">
      <button
        v-for="s in SCENES"
        :key="s.id"
        type="button"
        class="gv-tab"
        :class="{ 'gv-tab--active': s.id === activeSceneId }"
        :title="s.tagline"
        @click="switchScene(s.id)"
      >
        {{ s.label }}
      </button>
    </div>
    <button
      type="button"
      style="margin-left: auto; border: 1px solid var(--gv-border); background: #fff; border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;"
      @click="isDrawerOpen = !isDrawerOpen"
    >
      <Bot :size="13" />
      {{ isDrawerOpen ? "收起 Copilot" : "打开 Copilot" }}
    </button>
  </div>

  <div class="gv-main">
    <!-- 左侧：场景宿主面板（真实业务页面形态） -->
    <section
      class="gv-stage"
      :class="{ 'gv-stage--pushed': isDrawerOpen }"
    >
      <component
        :is="activeScene.host"
        @quick="(prompt: string) => chat.send(prompt)"
      />
    </section>

    <!-- 右侧：全场景共享 Copilot 抽屉 -->
    <aside v-if="isDrawerOpen" class="drawer">
      <div class="drawer__head">
        <div class="drawer__title">
          <Bot :size="17" style="color: var(--gv-accent)" />
          <span>Gallery Copilot</span>
          <span class="drawer__badge">{{ activeScene.label }}</span>
        </div>
        <button type="button" class="drawer__close" title="收起抽屉" @click="isDrawerOpen = false">
          <X :size="15" />
        </button>
      </div>

      <!-- 快捷场景 chip -->
      <div class="drawer__chips">
        <span class="drawer__chips-label">演练：</span>
        <button
          v-for="chip in activeScene.chips"
          :key="chip.label"
          type="button"
          class="chip"
          :class="{ 'chip--action': chip.tone === 'action' }"
          :disabled="chat.isStreaming.value"
          @click="chat.send(chip.prompt)"
        >
          {{ chip.label }}
        </button>
      </div>

      <!-- 消息流 -->
      <div ref="chatScrollRef" class="drawer__messages">
        <template v-for="turn in chat.turns.value" :key="turn.id">
          <VaUserBubble v-if="turn.role === 'user'" :content="turn.text" avatar="你" />

          <VaAssistantTurn
            v-else
            :content="turn.text"
            :thought="turn.thought"
            :thought-expanded="turn.showThought"
            :streaming="chat.isStreaming.value && turn === chat.turns.value[chat.turns.value.length - 1]"
            @update:thought-expanded="(val: boolean) => (turn.showThought = val)"
          >
            <div v-if="turn.cards.length" class="drawer__cards">
              <!-- 卡片内交互回传：卡片 emit quick(prompt) 直接驱动下一轮 agent 调用 -->
              <component
                :is="getCardComponent(card.component)"
                v-for="card in turn.cards"
                :key="card.id"
                v-bind="card.props"
                @quick="(prompt: string) => chat.send(prompt)"
              />
            </div>

            <div v-if="turn.form" class="drawer__approval">
              <!-- L2 表单卡（ui_form）：提交/取消走交互信封；422 fieldErrors 就地回填重填 -->
              <VaForm
                :title="turn.form.args.title"
                :description="turn.form.args.description"
                :fields="Array.isArray(turn.form.args.fields) ? turn.form.args.fields : []"
                :submit-label="turn.form.args.submitLabel || '提交'"
                :disabled="turn.formStatus !== 'pending'"
                :field-errors="turn.formErrors"
                @submit="(values: Record<string, unknown>, edited: string[]) => chat.submitForm(turn, values, edited)"
                @cancel="() => chat.cancelForm(turn)"
              />
              <p v-if="turn.formStatus === 'done'" class="drawer__form-note">✅ 表单已提交，agent 正在继续执行</p>
              <p v-else-if="turn.formStatus === 'cancelled'" class="drawer__form-note">已放弃本次填写</p>
            </div>

            <div v-if="turn.approval" class="drawer__approval">
              <VaApprovalCard
                :title="turn.approval.title"
                :detail="turn.approval.detail"
                :risk="turn.approval.risk"
                :decided="turn.approvalDecided === 'approved' ? 'approved' : turn.approvalDecided === 'denied' ? 'denied' : undefined"
                @approve="() => chat.decide(turn, true)"
                @deny="(reason?: string) => chat.decide(turn, false, reason)"
              />
            </div>
          </VaAssistantTurn>
        </template>
      </div>

      <!-- 输入区 -->
      <div class="drawer__footer">
        <VaComposer
          v-model:text="chat.composerText.value"
          :placeholder="'输入任务，或点击上方演练按钮…'"
          :disabled="chat.isStreaming.value"
          @send="() => chat.send()"
        />
        <div class="drawer__session">
          <ChevronDown :size="11" />
          <span>session: {{ chat.sessionId.value }}</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* ---- Copilot 抽屉 ---- */
.drawer {
  position: fixed;
  top: 52px;
  right: 0;
  bottom: 0;
  width: 500px;
  max-width: 92vw;
  background: #ffffff;
  border-left: 1px solid var(--gv-border);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.drawer__head {
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--gv-border);
}
.drawer__title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.drawer__badge { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: #fff1e7; color: var(--gv-accent); font-weight: 500; }
.drawer__close { background: none; border: none; cursor: pointer; color: var(--gv-muted); display: flex; padding: 4px; border-radius: 4px; }
.drawer__close:hover { background: #f1f5f9; }

.drawer__chips {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 14px; background: #fafafa; border-bottom: 1px solid var(--gv-border);
}
.drawer__chips-label { font-size: 11px; color: var(--gv-muted); }
.chip {
  font-size: 11px; padding: 3px 9px; border: 1px solid var(--gv-border);
  background: #fff; border-radius: 999px; cursor: pointer; color: #334155; transition: all 0.15s;
}
.chip:hover:not(:disabled) { border-color: var(--gv-accent); color: var(--gv-accent); background: #fff1e7; }
.chip--action:hover:not(:disabled) { border-color: #ea580c; color: #ea580c; background: #fff7ed; }
.chip:disabled { opacity: 0.5; cursor: not-allowed; }

.drawer__messages {
  flex: 1; overflow-y: auto; padding: 14px;
  display: flex; flex-direction: column; gap: 14px; background: #fdfdfd;
}
.drawer__cards { display: flex; flex-direction: column; gap: 8px; }
.drawer__approval { margin-top: 4px; }

.drawer__footer { border-top: 1px solid var(--gv-border); padding: 10px 14px 8px; background: #fff; }
.drawer__session {
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; color: var(--gv-muted); margin-top: 6px;
  font-family: var(--va-font-mono, monospace);
}
</style>
