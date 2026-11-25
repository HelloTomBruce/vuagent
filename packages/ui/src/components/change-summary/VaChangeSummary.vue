<script setup lang="ts">
import { computed, ref } from "vue";
import { useStagger } from "../../composables/useStagger";
import type { ChangeSummaryEvents, ChangeSummaryProps } from "./types";
import { FILE_STATUS_LABEL } from "../file-tree/types";
import { formatMs } from "../../utils/format";

const props = defineProps<ChangeSummaryProps>();

const emit = defineEmits<ChangeSummaryEvents>();

const totals = computed(() =>
  props.files.reduce(
    (acc, f) => ({ additions: acc.additions + (f.additions ?? 0), deletions: acc.deletions + (f.deletions ?? 0) }),
    { additions: 0, deletions: 0 },
  ),
);

/** 超过 maxFiles 时默认折叠 */
const collapsed = ref(true);
const overflow = computed(() =>
  props.maxFiles !== undefined ? Math.max(0, props.files.length - props.maxFiles) : 0,
);
const shown = computed(() =>
  overflow.value && collapsed.value ? props.files.slice(0, props.maxFiles) : props.files,
);

/**
 * 文件行错峰（TASK-108）：统一消费 useStagger（animation-delay 轴，配合 .va-enter-*
 * 动画类使用；默认档位对齐 --va-stagger 40ms 步长、8 档钳制、reduced-motion 归零；
 * SSR 无 window 按正常分支输出，服务端与客户端首帧一致）。
 */
const { delayStyle } = useStagger();
</script>

<template>
  <!-- 入场（TASK-108）：根卡片上浮，文件行错峰跟随（motion.css 统一协议） -->
  <section class="va-cs va-enter-up" aria-label="变更摘要">
    <header class="va-cs__head">
      <span class="va-cs__title">{{ props.title ?? "本轮变更" }}</span>
      <span class="va-cs__stats" role="status">
        {{ files.length }} 个文件
        <template v-if="totals.additions || totals.deletions">
          · <b class="va-cs__add">+{{ totals.additions }}</b> <b class="va-cs__del">−{{ totals.deletions }}</b>
        </template>
        <template v-if="props.duration"> · {{ formatMs(props.duration) }}</template>
        <template v-if="props.toolCalls"> · {{ props.toolCalls }} 次工具调用</template>
      </span>
    </header>

    <ul class="va-cs__files">
      <li v-for="(f, i) in shown" :key="f.path" class="va-enter-up" :style="delayStyle(i)">
        <button class="va-cs__file" type="button" @click="emit('openFile', f)">
          <span v-if="f.status" class="va-cs__status" :data-status="f.status">{{ FILE_STATUS_LABEL[f.status] }}</span>
          <span class="va-cs__path">{{ f.path }}</span>
          <span v-if="f.additions || f.deletions" class="va-cs__diff">
            <b class="va-cs__add">+{{ f.additions ?? 0 }}</b>
            <b class="va-cs__del">−{{ f.deletions ?? 0 }}</b>
          </span>
        </button>
      </li>
    </ul>

    <button v-if="overflow" class="va-cs__more" type="button" @click="collapsed = !collapsed; emit('toggleAll')">
      {{ collapsed ? `展开其余 ${overflow} 个文件` : `收起，只看前 ${props.maxFiles} 个` }}
    </button>
  </section>
</template>

<style src="./VaChangeSummary.css"></style>
