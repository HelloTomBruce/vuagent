<script setup lang="ts">
import type { AgentInboxProps, AgentTask } from "./types";
import { AGENT_STATUS_LABEL } from "./types";
import { useAgentInbox } from "./useAgentInbox";
import { formatMs } from "../../utils/format";

const props = defineProps<AgentInboxProps>();

const emit = defineEmits<{
  open: [task: AgentTask];
  retry: [task: AgentTask];
  cancel: [task: AgentTask];
}>();

const { filter, tabs, counts, visible, elapsedOf, expandedId, toggle } = useAgentInbox(props);
</script>

<template>
  <div class="va-inb" role="list">
    <div class="va-inb__tabs" role="tablist" aria-label="任务过滤">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="va-inb__tab"
        :class="{ 'va-inb__tab--on': filter === tab.key }"
        type="button"
        role="tab"
        :aria-selected="filter === tab.key"
        @click="filter = tab.key"
      >
        {{ tab.label }}
        <span class="va-inb__count">{{ counts[tab.key] }}</span>
      </button>
    </div>

    <TransitionGroup tag="div" class="va-inb__list" name="va-inb">
      <article
        v-for="t in visible"
        :key="t.id"
        class="va-inb__row"
        role="listitem"
        :class="{ 'va-inb__row--open': expandedId === t.id }"
        :data-status="t.status"
      >
        <button class="va-inb__main" type="button" :aria-expanded="expandedId === t.id" @click="toggle(t)">
          <span class="va-inb__dot" aria-hidden="true" />
          <span class="va-inb__text">
            <span class="va-inb__title">{{ t.title }}</span>
            <span class="va-inb__sub">
              <span v-if="t.agent" class="va-inb__agent">{{ t.agent }}</span>
              <span class="va-inb__status">{{ AGENT_STATUS_LABEL[t.status] }}</span>
              <span v-if="elapsedOf(t) !== undefined" class="va-inb__time">{{ formatMs(elapsedOf(t)!) }}</span>
            </span>
          </span>
          <svg class="va-inb__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="m9.5 7 5 5-5 5" />
          </svg>
        </button>

        <div v-if="expandedId === t.id" class="va-inb__detail">
          <p v-if="t.error" class="va-inb__error">{{ t.error }}</p>
          <ol v-if="t.steps?.length" class="va-inb__steps">
            <li v-for="(s, i) in t.steps" :key="i">{{ s }}</li>
          </ol>
          <div class="va-inb__actions">
            <button class="va-inb__act" type="button" @click="emit('open', t)">打开</button>
            <button v-if="t.status === 'error' || t.status === 'done'" class="va-inb__act" type="button" @click="emit('retry', t)">重试</button>
            <button
              v-if="t.status === 'queued' || t.status === 'running' || t.status === 'waiting'"
              class="va-inb__act va-inb__act--danger"
              type="button"
              @click="emit('cancel', t)"
            >取消</button>
          </div>
        </div>
      </article>
    </TransitionGroup>

    <p v-if="!visible.length" class="va-inb__empty">这个视图下没有任务。</p>
  </div>
</template>

<style src="./VaAgentInbox.css"></style>
