<script setup lang="ts">
import { computed } from "vue";
import type { AgentPlanProps, PlanStep } from "./types";
import { useAgentPlan } from "./useAgentPlan";
import { formatMs } from "../../utils/format";

const props = withDefaults(defineProps<AgentPlanProps>(), { editable: false, title: "执行计划" });

const emit = defineEmits<{
  "update:steps": [steps: PlanStep[]];
  retry: [step: PlanStep];
  confirm: [];
  cancel: [];
}>();

const {
  elapsedOf,
  doneCount,
  anyError,
  editingId,
  draft,
  addDraft,
  startRename,
  rename,
  move,
  remove,
  add,
} = useAgentPlan(props, {
  "update:steps": (steps) => emit("update:steps", steps),
});

const timeOf = computed(() => (s: PlanStep) => {
  const ms = elapsedOf(s);
  return ms === undefined ? undefined : formatMs(ms);
});

/* L3 协作出口（挂起等待用户编辑/确认）：fieldErrors 逐条展开为错误行 */
const errorLines = computed(() =>
  Object.entries(props.fieldErrors ?? {}).map(([key, message]) => `${key}：${message}`)
);
</script>

<template>
  <div class="va-plan" :class="props.editable ? 'va-plan--edit' : ''">
    <header class="va-plan__head">
      <h4 class="va-plan__title">{{ props.title }}</h4>
      <span v-if="!props.editable && props.steps.length" class="va-plan__progress" :data-error="anyError || undefined">
        {{ doneCount }}/{{ props.steps.length }} 步
        <template v-if="anyError"> · 有失败</template>
      </span>
      <span v-else-if="props.editable" class="va-plan__progress">可调整后交给 agent 执行</span>
    </header>

    <TransitionGroup tag="ol" class="va-plan__list" name="va-plan">
      <li v-for="(s, i) in props.steps" :key="s.id" class="va-plan__item" :data-status="s.status ?? 'pending'">
        <!-- 编辑模式 -->
        <template v-if="props.editable">
          <div class="va-plan__edit-row">
            <span class="va-plan__idx">{{ i + 1 }}</span>
            <input
              v-if="editingId === s.id"
              v-model="draft"
              class="va-plan__input"
              type="text"
              autofocus
              @keydown.enter="rename(s)"
              @keydown.esc="editingId = null"
              @blur="rename(s)"
            />
            <button v-else class="va-plan__rename" type="button" title="点击重命名" @click="startRename(s)">
              {{ s.title }}
            </button>
            <span class="va-plan__ops">
              <button class="va-act va-act--ghost va-plan__op" type="button" aria-label="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
              <button class="va-act va-act--ghost va-plan__op" type="button" aria-label="下移" :disabled="i === props.steps.length - 1" @click="move(i, 1)">↓</button>
              <button class="va-act va-act--ghost va-plan__op va-plan__op--danger" type="button" aria-label="删除步骤" @click="remove(s)">✕</button>
            </span>
          </div>
        </template>

        <!-- 运行模式 -->
        <template v-else>
          <span class="va-plan__node" aria-hidden="true">
            <span v-if="s.status === 'running'" class="va-plan__spin" />
            <svg v-else-if="s.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M5.5 12.5l4 4L18.5 8" />
            </svg>
            <svg v-else-if="s.status === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 8v4.5M12 16h.01" />
            </svg>
            <span v-else class="va-plan__dot" />
          </span>
          <div class="va-plan__body">
            <span class="va-plan__step-title" :data-done="s.status === 'done' || undefined">{{ s.title }}</span>
            <span v-if="s.detail" class="va-plan__step-detail">{{ s.detail }}</span>
          </div>
          <div class="va-plan__side">
            <span v-if="timeOf(s) !== undefined" class="va-plan__time">{{ timeOf(s) }}</span>
            <button v-if="s.status === 'error'" class="va-act va-act--sm va-act--danger va-plan__retry" type="button" @click="emit('retry', s)">↻ 重试</button>
          </div>
        </template>
      </li>
    </TransitionGroup>

    <div v-if="props.editable" class="va-plan__add">
      <input
        v-model="addDraft"
        class="va-plan__input"
        type="text"
        placeholder="添加步骤…"
        @keydown.enter="add"
      />
      <button class="va-plan__add-btn" type="button" :disabled="!addDraft.trim()" @click="add">＋ 添加</button>
    </div>

    <!-- L3 协作出口：仅 collaborative（挂起等待人工）时渲染；confirm/cancel 均为终态 -->
    <footer v-if="props.collaborative" class="va-plan__collab">
      <div v-if="errorLines.length" class="va-plan__errors" role="alert">
        <span v-for="line in errorLines" :key="line" class="va-plan__error">{{ line }}</span>
      </div>
      <div class="va-plan__collab-actions">
        <button class="va-plan__confirm" type="button" :disabled="props.disabled" @click="emit('confirm')">确认计划</button>
        <button class="va-plan__giveup" type="button" :disabled="props.disabled" @click="emit('cancel')">放弃</button>
      </div>
    </footer>
  </div>
</template>

<style src="./VaAgentPlan.css"></style>
