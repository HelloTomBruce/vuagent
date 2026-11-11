<script setup lang="ts">
import type { Decision, DecisionAnswer, DecisionInboxProps } from "./types";
import { useDecisionInbox } from "./useDecisionInbox";

const props = defineProps<DecisionInboxProps>();
const emit = defineEmits<{ decide: [decision: Decision, answer: DecisionAnswer] }>();

const { states, answer, visible, pending } = useDecisionInbox(props);

function choose(d: Decision, which: DecisionAnswer) {
  if (answer(d, which)) emit("decide", d, which);
}
</script>

<template>
  <div class="va-dib" :data-empty="!visible.length || undefined">
    <p v-if="visible.length" class="va-dib__head" role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M12 9v4M12 16.5h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      {{ pending.length ? `${pending.length} 项待你拍板` : "全部已处理" }}
    </p>

    <TransitionGroup v-else name="va-dib-fade" tag="div">
      <p key="empty" class="va-dib__empty">收件箱清空了，去忙别的吧。</p>
    </TransitionGroup>

    <TransitionGroup name="va-dib" tag="div" class="va-dib__list">
      <article
        v-for="d in visible"
        :key="d.id"
        class="va-dib__item"
        :class="{ 'va-dib__item--folded': !states[d.id]?.open, 'va-dib__item--answered': states[d.id]?.answered }"
      >
        <button
          v-if="!states[d.id]?.open && !states[d.id]?.answered"
          class="va-dib__fold"
          type="button"
          @click="states[d.id]!.open = true"
        >
          <span class="va-dib__fold-title">{{ d.title }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="m9.5 7 5 5-5 5" />
          </svg>
        </button>

        <template v-else>
          <h4 class="va-dib__title">{{ d.title }}</h4>
          <p v-if="d.detail" class="va-dib__detail">{{ d.detail }}</p>

          <div v-if="states[d.id]?.answered" class="va-dib__confirm" role="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <path d="M5.5 12.5l4 4L18.5 8" />
            </svg>
            已选择「{{ states[d.id]?.answered === "primary" ? d.primary : d.secondary }}」
          </div>
          <div v-else class="va-dib__actions">
            <button class="va-act va-act--ink va-dib__btn" type="button" @click="choose(d, 'primary')">{{ d.primary }}</button>
            <button class="va-act va-dib__btn" type="button" @click="choose(d, 'secondary')">{{ d.secondary }}</button>
          </div>
        </template>
      </article>
    </TransitionGroup>
  </div>
</template>

<style src="./VaDecisionInbox.css"></style>
