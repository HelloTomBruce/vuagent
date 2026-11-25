<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { Archive, ArchiveRestore, Check, ChevronDown, Pen, Plus, Trash2, X } from "lucide-vue-next";
import type { SessionItem, SessionManagerEvents, SessionManagerProps } from "./types";

const props = withDefaults(defineProps<SessionManagerProps>(), {
  disabled: false,
  ariaLabel: "会话管理",
});

const emit = defineEmits<SessionManagerEvents>();

const open = ref(false);
const rootEl = useTemplateRef<HTMLElement>("root");

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (!open.value) resetEdits();
}

/** Esc 关闭 + 点击外部关闭（SSR 安全：onMounted 内挂） */
function onDocMousedown(e: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) {
    open.value = false;
    resetEdits();
  }
}
function onDocKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    open.value = false;
    resetEdits();
  }
}
onMounted(() => {
  if (typeof document === "undefined") return;
  document.addEventListener("mousedown", onDocMousedown);
  document.addEventListener("keydown", onDocKeydown);
});
onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.removeEventListener("mousedown", onDocMousedown);
  document.removeEventListener("keydown", onDocKeydown);
});

/* 行内重命名 */
const editingId = ref<string | null>(null);
const draft = ref("");
function startRename(s: SessionItem) {
  editingId.value = s.id;
  draft.value = s.title || "未命名会话";
}
function commitRename() {
  if (editingId.value) {
    const t = draft.value.trim();
    if (t && t !== (props.sessions.find((x) => x.id === editingId.value)?.title ?? "")) {
      emit("rename", editingId.value, t);
    }
  }
  editingId.value = null;
}
function cancelRename() {
  editingId.value = null;
}

/* 删除二次确认 */
const confirmId = ref<string | null>(null);
function askRemove(id: string) {
  if (confirmId.value === id) {
    emit("remove", id);
    confirmId.value = null;
  } else {
    confirmId.value = id;
    window.setTimeout(() => {
      if (confirmId.value === id) confirmId.value = null;
    }, 3000);
  }
}

function resetEdits() {
  editingId.value = null;
  confirmId.value = null;
}

function pick(s: SessionItem) {
  if (s.id !== props.activeId) emit("select", s.id);
  open.value = false;
  resetEdits();
}

function onCreate() {
  emit("create");
  open.value = false;
  resetEdits();
}

const activeList = computed(() => props.sessions.filter((s) => !s.archived));
const archivedList = computed(() => props.sessions.filter((s) => s.archived));

const titleOf = (s: SessionItem) => s.title || "未命名会话";
function fmtTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}
</script>

<template>
  <div ref="root" class="va-smn">
    <button
      class="va-smn__trigger"
      type="button"
      :disabled="props.disabled"
      :aria-expanded="open"
      :aria-label="props.ariaLabel"
      @click="toggle"
    >
      会话
      <ChevronDown :size="14" aria-hidden="true" />
    </button>

    <div v-if="open" class="va-smn__panel" role="dialog" :aria-label="props.ariaLabel">
      <header class="va-smn__head">
        <span class="va-smn__head-title">会话</span>
        <button class="va-smn__new" type="button" @click="onCreate"><Plus :size="14" aria-hidden="true" />新建</button>
      </header>

      <div class="va-smn__list">
        <template v-if="activeList.length">
          <div v-for="s in activeList" :key="s.id" class="va-smn__row" :data-active="s.id === props.activeId || undefined">
            <template v-if="editingId === s.id">
              <input
                v-model="draft"
                class="va-smn__input"
                type="text"
                @keydown.enter.prevent="commitRename"
                @keydown.escape.prevent="cancelRename"
              />
              <button class="va-smn__op" type="button" @click="commitRename"><Check :size="14" /></button>
              <button class="va-smn__op" type="button" @click="cancelRename"><X :size="14" /></button>
            </template>
            <template v-else>
              <button class="va-smn__main" type="button" :title="titleOf(s)" @click="pick(s)">
                <span class="va-smn__title">{{ titleOf(s) }}</span>
                <span class="va-smn__time">{{ fmtTime(s.updatedAt) }}</span>
              </button>
              <button class="va-smn__op" type="button" aria-label="重命名" @click.stop="startRename(s)"><Pen :size="13" /></button>
              <button class="va-smn__op" type="button" aria-label="归档" @click.stop="emit('archive', s.id, true)"><Archive :size="13" /></button>
              <button
                class="va-smn__op"
                type="button"
                :data-danger="confirmId === s.id || undefined"
                :aria-label="confirmId === s.id ? '确认删除' : '删除'"
                @click.stop="askRemove(s.id)"
              ><span v-if="confirmId === s.id" class="va-smn__confirm">确认?</span><Trash2 v-else :size="13" /></button>
            </template>
          </div>
        </template>
        <p v-else class="va-smn__empty va-fade-in">还没有会话，点「＋ 新建」开始。</p>

        <template v-if="archivedList.length">
          <div class="va-smn__group">已归档</div>
          <div v-for="s in archivedList" :key="s.id" class="va-smn__row" :data-archived="true">
            <template v-if="editingId === s.id">
              <input v-model="draft" class="va-smn__input" type="text" @keydown.enter.prevent="commitRename" @keydown.escape.prevent="cancelRename" />
              <button class="va-smn__op" type="button" @click="commitRename"><Check :size="14" /></button>
              <button class="va-smn__op" type="button" @click="cancelRename"><X :size="14" /></button>
            </template>
            <template v-else>
              <span class="va-smn__main va-smn__main--static">
                <span class="va-smn__title">{{ titleOf(s) }}</span>
                <span class="va-smn__time">{{ fmtTime(s.updatedAt) }}</span>
              </span>
              <button class="va-smn__op" type="button" aria-label="恢复" @click.stop="emit('archive', s.id, false)"><ArchiveRestore :size="13" /></button>
              <button
                class="va-smn__op"
                type="button"
                :data-danger="confirmId === s.id || undefined"
                @click.stop="askRemove(s.id)"
              ><span v-if="confirmId === s.id" class="va-smn__confirm">确认?</span><Trash2 v-else :size="13" /></button>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style src="./VaSessionManager.css"></style>
