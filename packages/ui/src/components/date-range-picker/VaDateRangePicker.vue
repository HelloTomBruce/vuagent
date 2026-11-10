<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { DateRangePickerEvents, DateRangePickerProps } from "./types";
import { useDateRange } from "./useDateRange";

const props = defineProps<DateRangePickerProps>();

const emit = defineEmits<DateRangePickerEvents>();

const rootEl = useTemplateRef<HTMLElement>("root");

const emitter = {
  start: (v: number) => emit("update:start", v),
  end: (v: number) => emit("update:end", v),
  change: (r: { start: number; end: number }) => emit("change", r),
};

const {
  open,
  presets,
  leftGrid,
  rightGrid,
  monthLabel,
  summary,
  shiftMonth,
  onPick,
  applyPreset,
  hoverTs,
  cellState,
} = useDateRange(props, rootEl);

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const today = new Date();
const todayTs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
</script>

<template>
  <div ref="root" class="va-drp">
    <button
      class="va-drp__trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span aria-hidden="true">▤</span> {{ summary }}
    </button>

    <div v-if="open" class="va-drp__panel" role="dialog" aria-label="选择日期范围">
      <div class="va-drp__presets">
        <button
          v-for="p in presets"
          :key="p.id"
          class="va-drp__preset"
          type="button"
          @click="applyPreset(p, emitter)"
        >{{ p.label }}</button>
      </div>

      <div class="va-drp__calendars">
        <div class="va-drp__cal">
          <header class="va-drp__month">
            <button class="va-drp__nav" type="button" aria-label="上一个月" @click="shiftMonth(-1)">‹</button>
            <span>{{ monthLabel(0) }}</span>
          </header>
          <div class="va-drp__grid" role="grid" :aria-label="monthLabel(0)">
            <span v-for="w in WEEKDAYS" :key="w" class="va-drp__wd" aria-hidden="true">{{ w }}</span>
            <button
              v-for="c in leftGrid"
              :key="c.ts"
              class="va-drp__day"
              type="button"
              :data-state="cellState(c.ts)"
              :data-out="!c.inMonth"
              :data-today="c.ts === todayTs"
              :aria-label="new Date(c.ts).toLocaleDateString()"
              @click="onPick(c.ts, emitter)"
              @mouseenter="hoverTs = c.ts"
              @mouseleave="hoverTs = null"
            >{{ c.day }}</button>
          </div>
        </div>

        <div v-if="props.months !== 1" class="va-drp__cal">
          <header class="va-drp__month">
            <span>{{ monthLabel(1) }}</span>
            <button class="va-drp__nav" type="button" aria-label="下一个月" @click="shiftMonth(1)">›</button>
          </header>
          <div class="va-drp__grid" role="grid" :aria-label="monthLabel(1)">
            <span v-for="w in WEEKDAYS" :key="w" class="va-drp__wd" aria-hidden="true">{{ w }}</span>
            <button
              v-for="c in rightGrid"
              :key="c.ts"
              class="va-drp__day"
              type="button"
              :data-state="cellState(c.ts)"
              :data-out="!c.inMonth"
              :data-today="c.ts === todayTs"
              :aria-label="new Date(c.ts).toLocaleDateString()"
              @click="onPick(c.ts, emitter)"
              @mouseenter="hoverTs = c.ts"
              @mouseleave="hoverTs = null"
            >{{ c.day }}</button>
          </div>
        </div>
      </div>

      <footer class="va-drp__foot">
        <span class="va-drp__hint">点击两个日期确定范围</span>
        <button
          class="va-drp__clear"
          type="button"
          @click="emitter.start(Date.now()); emitter.end(Date.now()); open = false"
        >跳到今天</button>
      </footer>
    </div>
  </div>
</template>

<style src="./VaDateRangePicker.css"></style>
