<script setup lang="ts">
import { computed, ref, type PropType } from "vue";
import { Clock3, Layers, Repeat2, Search, Wrench, X } from "lucide-vue-next";
import type { TrajEvent, TrajectoryEvents } from "./types";
import { useTrajectoryReveal } from "./useTrajectoryReveal";

/**
 * 运行时 props 声明（而非类型导入式声明）：
 * 类型式声明的 props 元数据依赖编译期对 types.ts 的解析，dev HMR 场景下
 * types.ts 的增量变更偶尔不会触发 SFC 重编译，导致新增 prop 不生效；
 * 运行时声明与类型文件解耦，热更后必然生效。
 * 契约类型仍由 types.ts 的 TrajectoryProps 对外导出。
 */
const props = defineProps({
  events: { type: Array as PropType<TrajEvent[]>, required: true },
  /** 台账区最大高度 px（默认 none，随容器） */
  ledgerMaxHeight: { type: Number, default: undefined },
  /** 是否渲染外层面板卡片（宽幅主区嵌入传 false 去卡片化） */
  bordered: { type: Boolean, default: true },
  /** 主从模式：点击台账行在右侧详情区展示完整内容 */
  splitDetail: { type: Boolean, default: false },
});

const emit = defineEmits<TrajectoryEvents>();

/* ---------- 指标 ---------- */
const t0 = computed(() => props.events[0]?.at ?? 0);
const t1 = computed(() => {
  const last = props.events.at(-1);
  if (!last) return 0;
  return Math.max(last.endAt ?? last.at, props.events[0]?.at ?? 0);
});
const span = computed(() => Math.max(t1.value - t0.value, 1));
const stats = computed(() => ({
  durationMs: Math.max(t1.value - t0.value, 0),
  turns: new Set(props.events.map((e) => e.turn)).size,
  calls: props.events.filter((e) => e.lane === "tool").length,
  subcalls: 0,
}));

const fmtDur = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

/* ---------- 泳道 ---------- */
const LANES: Array<{ key: string; label: string }> = [
  { key: "input", label: "输入" },
  { key: "model", label: "模型" },
  { key: "tool", label: "工具" },
];
const laneEvents = (key: string) => props.events.filter((e) => e.lane === key);
function blockStyle(e: TrajEvent) {
  const left = ((e.at - t0.value) / span.value) * 100;
  return { left: `${Math.min(Math.max(left, 0), 99)}%` };
}

/* ---------- 台账（搜索 + 展开 / 主从详情） ---------- */
const keyword = ref("");
const expandedIds = ref<Set<string>>(new Set());
function toggleRow(id: string) {
  const open = !expandedIds.value.has(id);
  const next = new Set(expandedIds.value);
  if (open) next.add(id);
  else next.delete(id);
  expandedIds.value = next;
  emit("toggle", id, open);
}

/** 主从模式：右侧详情区当前选中的事件；再点同一条或点关闭即收起 */
const selectedId = ref<string | null>(null);
const selectedEvent = computed(
  () => props.events.find((e) => e.id === selectedId.value) ?? null
);
function selectRow(id: string) {
  selectedId.value = selectedId.value === id ? null : id;
  emit("select", selectedId.value);
}
function closeDetail() {
  selectedId.value = null;
  emit("select", null);
}

/** 行激活分发：主从模式 → 右侧详情；传统模式 → 行内展开 */
function onRowActivate(e: TrajEvent) {
  if (props.splitDetail) selectRow(e.id);
  else toggleRow(e.id);
}
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return props.events;
  return props.events.filter(
    (e) => e.title.toLowerCase().includes(kw) || (e.detail ?? "").toLowerCase().includes(kw) || (e.result ?? "").toLowerCase().includes(kw),
  );
});

/** 台账行分组：turn 首行（或搜索命中首行）标 第N轮 */
const turnStartIds = computed(() => {
  const seen = new Set<number>();
  const ids = new Set<string>();
  for (const e of filtered.value) {
    if (!seen.has(e.turn)) {
      seen.add(e.turn);
      ids.add(e.id);
    }
  }
  return ids;
});

const fmtTime = (at: number) =>
  new Date(at).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

/* ---------- 渐进揭示（TASK-107）：IO 进视口逐节点点亮，逻辑见 useTrajectoryReveal ---------- */
const rootEl = ref<HTMLElement | null>(null);
const { active: revealActive, rowVisible, blocksVisible } = useTrajectoryReveal(rootEl, filtered);

const ROLE_LABEL: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  system: "系统",
  context: "上下文",
};

function snippet(e: TrajEvent): string {
  if (e.lane === "tool") {
    const d = e.detail && e.detail.length > 240 ? `${e.detail.slice(0, 240)}…` : (e.detail ?? "");
    const r = e.result && e.result.length > 240 ? `${e.result.slice(0, 240)}…` : (e.result ?? "");
    return d ? `${d}  →  ${r}` : r;
  }
  return e.title;
}
</script>

<template>
  <div
    ref="rootEl"
    class="va-traj"
    :class="{
      'va-traj--plain': props.bordered === false,
      'va-traj--split': props.splitDetail,
    }"
    :data-reveal="revealActive ? 'on' : undefined"
  >
    <div class="va-traj__panel">
    <!-- 指标条：时长/轮次/调用/子调用 + 搜索 -->
    <div class="va-traj__bar">
      <span class="va-traj__chip"><Clock3 :size="12" aria-hidden="true" />时长 {{ fmtDur(stats.durationMs) }}</span>
      <span class="va-traj__chip"><Repeat2 :size="12" aria-hidden="true" />轮次 {{ stats.turns }}</span>
      <span class="va-traj__chip"><Wrench :size="12" aria-hidden="true" />调用 {{ stats.calls }}</span>
      <span class="va-traj__chip"><Layers :size="12" aria-hidden="true" />子调用 {{ stats.subcalls }}</span>
      <span class="va-traj__spacer" />
      <label class="va-traj__search">
        <Search :size="13" aria-hidden="true" />
        <input v-model="keyword" type="text" placeholder="搜索" aria-label="搜索轨迹事件" />
      </label>
    </div>

    <!-- 三泳道时间线 -->
    <div class="va-traj__lanes">
      <div v-for="lane in LANES" :key="lane.key" class="va-traj__lane">
        <span class="va-traj__lane-label">{{ lane.label }}</span>
        <div class="va-traj__track">
          <span
            v-for="e in laneEvents(lane.key)"
            :key="e.id"
            class="va-traj__block"
            :data-lane="lane.key"
            :data-shown="blocksVisible ? 'true' : undefined"
            :style="blockStyle(e)"
            :title="`${fmtTime(e.at)} ${e.title}`"
          />
        </div>
      </div>
    </div>

    <!-- 扁平事件台账 -->
    <div class="va-traj__ledger" :style="props.ledgerMaxHeight ? { maxHeight: `${props.ledgerMaxHeight}px` } : undefined">
      <p v-if="!filtered.length" class="va-traj__empty">
        {{ props.events.length ? "没有匹配的事件。" : "还没有轨迹。发一条任务，这里会按轮记录全部事件。" }}
      </p>
      <div
        v-for="e in filtered"
        :key="e.id"
        class="va-traj__row"
        :data-id="e.id"
        :data-shown="rowVisible(e.id) ? 'true' : undefined"
        :title="`${fmtTime(e.at)}${e.endAt ? ` · ${fmtDur(e.endAt - e.at)}` : ''}`"
        :data-open="(!props.splitDetail && expandedIds.has(e.id)) || undefined"
        :data-selected="(props.splitDetail && selectedId === e.id) || undefined"
        role="button"
        tabindex="0"
        @click="onRowActivate(e)"
        @keydown.enter.prevent="onRowActivate(e)"
      >
        <span class="va-traj__rail">
          <span v-if="turnStartIds.has(e.id)" class="va-traj__turn">第{{ e.turn }}轮</span>
          <i class="va-traj__dot" aria-hidden="true" />
        </span>
        <span class="va-traj__role" :data-role="e.role">{{ ROLE_LABEL[e.role] ?? e.role }}</span>
        <span class="va-traj__content" :data-tool="e.lane === 'tool' || undefined">
          <template v-if="e.lane === 'tool'"><b class="va-traj__toolname">{{ e.title }}</b> {{ snippet(e) }}</template>
          <template v-else>{{ e.title }}</template>
        </span>
      </div>
    </div>
    </div>

    <!-- 主从模式：右侧详情区（完整参数 / 结果） -->
    <aside v-if="props.splitDetail && selectedEvent" class="va-traj__detail">
      <header class="va-traj__detail-head">
        <span class="va-traj__role" :data-role="selectedEvent.role">
          {{ ROLE_LABEL[selectedEvent.role] ?? selectedEvent.role }}
        </span>
        <span class="va-traj__detail-meta">
          {{ fmtTime(selectedEvent.at) }}<template v-if="selectedEvent.endAt"> · {{ fmtDur(selectedEvent.endAt - selectedEvent.at) }}</template> · 第{{ selectedEvent.turn }}轮
        </span>
        <button
          class="va-traj__detail-close"
          type="button"
          title="关闭详情"
          aria-label="关闭详情"
          @click="closeDetail"
        >
          <X :size="14" />
        </button>
      </header>

      <div class="va-traj__detail-title">{{ selectedEvent.title }}</div>

      <section v-if="selectedEvent.detail">
        <h4>输入 / 参数</h4>
        <pre>{{ selectedEvent.detail }}</pre>
      </section>
      <section v-if="selectedEvent.result">
        <h4>结果 / 输出</h4>
        <pre>{{ selectedEvent.result }}</pre>
      </section>
      <p v-if="!selectedEvent.detail && !selectedEvent.result" class="va-traj__detail-none">
        该事件没有更多详情
      </p>
    </aside>
  </div>
</template>

<style src="./VaTrajectory.css"></style>
