<script setup lang="ts">
import type { InlineDiffProps } from "./types";
import { useInlineDiff } from "./useInlineDiff";

const props = defineProps<InlineDiffProps>();

const emit = defineEmits<{ apply: [result: string] }>();

const {
  units,
  decisions,
  undoStack,
  changeIdx,
  pendingCount,
  toggle,
  acceptAll,
  rejectAll,
  undo,
  reset,
  apply,
} = useInlineDiff(props, { apply: (result) => emit("apply", result) });
</script>

<template>
  <div class="va-dif">
    <header v-if="props.title || changeIdx.length" class="va-dif__head">
      <h4 v-if="props.title" class="va-dif__title">{{ props.title }}</h4>
      <span v-if="changeIdx.length" class="va-dif__meta" role="status">
        {{ changeIdx.length - pendingCount }}/{{ changeIdx.length }} 已决断
      </span>
    </header>

    <p class="va-dif__text">
      <template v-for="(u, i) in units" :key="i">
        <span v-if="u.same !== undefined" class="va-dif__same">{{ u.same }}</span>
        <button
          v-else
          class="va-dif__unit"
          type="button"
          :aria-pressed="decisions[i] ?? undefined"
          :data-state="decisions[i] === undefined ? 'pending' : decisions[i] ? 'accepted' : 'rejected'"
          :title="decisions[i] === undefined ? '点击接受（再点切换为拒绝）' : decisions[i] ? '已接受，点击改为拒绝' : '已拒绝，点击改为接受'"
          @click="toggle(i)"
        >
          <del v-if="u.del" class="va-dif__del">{{ u.del }}</del
          ><ins v-if="u.add" class="va-dif__add">{{ u.add }}</ins>
        </button>
      </template>
    </p>

    <footer v-if="changeIdx.length" class="va-dif__foot">
      <button class="va-btn va-btn--sm va-dif__btn" type="button" :disabled="!undoStack.length" @click="undo">撤销</button>
      <button class="va-btn va-btn--sm va-dif__btn" type="button" :disabled="!pendingCount" @click="acceptAll">全部接受</button>
      <button class="va-btn va-btn--sm va-dif__btn" type="button" :disabled="!pendingCount" @click="rejectAll">全部拒绝</button>
      <span class="va-dif__spacer" />
      <button class="va-btn va-btn--sm va-btn--ghost va-dif__btn" type="button" @click="reset">重置</button>
      <button class="va-btn va-btn--sm va-btn--ink va-dif__btn" type="button" :disabled="pendingCount > 0" @click="apply">
        应用修改
      </button>
    </footer>
    <p v-else class="va-dif__none">本段没有修改建议。</p>
  </div>
</template>

<style src="./VaInlineDiff.css"></style>
