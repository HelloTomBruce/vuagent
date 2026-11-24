<script setup lang="ts">
import { computed, ref } from "vue";
import { Bot, ChevronDown, RefreshCw, Sparkles, X } from "lucide-vue-next";
import {
  VaComposer,
  VaApprovalCard,
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
    <!-- 左侧：场景宿主面板（画布区） -->
    <section class="gv-stage">
      <div class="gv-stage__banner">
        <h1>{{ activeScene.label.replace(/^[①②③④⑤]\s*/, "") }}</h1>
        <p>{{ activeScene.tagline }}</p>
      </div>
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

        <div v-if="chat.isStreaming.value" class="drawer__streaming">
          <RefreshCw :size="13" class="gv-spin" style="color: var(--gv-accent)" />
          <span>agent 正在调用场景工具并执行…</span>
        </div>
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

.drawer__streaming {
  display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gv-muted);
  padding: 8px 12px; background: #f8fafc; border-radius: 6px;
}
.gv-spin { animation: gv-spin 1s linear infinite; }
@keyframes gv-spin { 100% { transform: rotate(360deg); } }

.drawer__footer { border-top: 1px solid var(--gv-border); padding: 10px 14px 8px; background: #fff; }
.drawer__session {
  display: flex; align-items: center; gap: 4px;
  font-size: 10px; color: var(--gv-muted); margin-top: 6px;
  font-family: var(--va-font-mono, monospace);
}
</style>
