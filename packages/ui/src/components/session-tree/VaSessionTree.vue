<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, FolderClosed, Pen, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-vue-next";
import type { SessionTreeEvents, SessionTreeProps, TreeSession } from "./types";

const props = withDefaults(defineProps<SessionTreeProps>(), {
  disabled: false,
  workspaceCreateMode: "input",
  newSession: false,
  searchable: false,
  collapsible: false,
  confirmMode: "inline",
  hoverOps: false,
});

const emit = defineEmits<SessionTreeEvents>();

/* 工作区分组折叠（collapsible 模式）：新工作区默认展开 */
const expandedWs = reactive(new Set<string>());
watch(
  () => props.workspaces.map((w) => w.id).join(","),
  (ids) => {
    if (!props.collapsible) return;
    for (const id of ids.split(",")) if (id) expandedWs.add(id);
  },
  { immediate: true }
);
function toggleWs(id: string) {
  if (expandedWs.has(id)) expandedWs.delete(id);
  else expandedWs.add(id);
}
const wsOpen = (id: string) => !props.collapsible || expandedWs.has(id);

/* 顶部常驻「＋ 新建会话」：目标 = 当前工作区（G7） */
function onNewSession() {
  if (props.disabled || !props.currentWorkspaceId) return;
  emit("createSession", props.currentWorkspaceId);
}

/* 会话搜索（G9）：组件内按标题过滤，隐藏无匹配分组 */
const keyword = ref("");
const matched = (s: TreeSession) => !keyword.value.trim() || (s.title || "未命名会话").toLowerCase().includes(keyword.value.trim().toLowerCase());
const searching = computed(() => keyword.value.trim().length > 0);

/* 新建工作区：input=行内输入框（Enter 创建 / Esc 取消）；picker=「＋」直接触发 createWorkspacePick */
const creatingWs = ref(false);
const wsDraft = ref("");
function startCreateWs() {
  if (props.disabled) return;
  if (props.workspaceCreateMode === "picker") {
    emit("createWorkspacePick");
    return;
  }
  creatingWs.value = true;
  wsDraft.value = "";
}
function commitCreateWs() {
  const name = wsDraft.value.trim();
  if (name) emit("createWorkspace", name);
  creatingWs.value = false;
}
function cancelCreateWs() {
  creatingWs.value = false;
}

/* 行内重命名 */
const editingId = ref<string | null>(null);
const draft = ref("");
function startRename(s: TreeSession) {
  if (props.disabled) return;
  editingId.value = s.id;
  draft.value = s.title || "未命名会话";
}
function commitRename() {
  if (editingId.value) {
    const t = draft.value.trim();
    const prev = [...props.sessions, ...props.archived].find((x) => x.id === editingId.value)?.title ?? "";
    if (t && t !== prev) emit("rename", editingId.value, t);
  }
  editingId.value = null;
}
function cancelRename() {
  editingId.value = null;
}

/* 删除二次确认（3s 内再次点击才生效）：会话与工作区分开记，避免 id 撞车。
   confirmMode="none"（宿主自行路由到 vaConfirm 等模态确认）时跳过行内确认直接发事件 */
const confirmId = ref<string | null>(null);
let confirmTimer: number | undefined;
function armConfirm(current: string | null, set: (v: string | null) => void, id: string, fire: () => void) {
  if (props.confirmMode === "none") {
    fire();
    return;
  }
  if (current === id) {
    fire();
    set(null);
  } else {
    set(id);
    window.clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => set(null), 3000);
  }
}
function askRemove(id: string) {
  if (props.disabled) return;
  armConfirm(confirmId.value, (v) => (confirmId.value = v), id, () => emit("remove", id));
}

/* 删除工作区（其下会话回到未分组，由宿主决定提示） */
const confirmWsId = ref<string | null>(null);
function askRemoveWorkspace(id: string) {
  if (props.disabled) return;
  armConfirm(confirmWsId.value, (v) => (confirmWsId.value = v), id, () => emit("removeWorkspace", id));
}

/* 平铺分区：工作区只是分组标题（无折叠无缩进），会话一列排开；搜索时过滤 */
const groups = computed(() =>
  props.workspaces.map((w) => ({
    workspace: w,
    sessions: props.sessions.filter((s) => (s.workspaceId ?? "") === w.id && matched(s)),
  })),
);

const orphans = computed(() => props.sessions.filter((s) => !knownWorkspace(s) && matched(s)));
function knownWorkspace(s: TreeSession): boolean {
  return props.workspaces.some((w) => w.id === (s.workspaceId ?? ""));
}

/* 已归档分区折叠态 */
const archivedOpen = ref(false);

const titleOf = (s: TreeSession) => s.title || "未命名会话";
function fmtTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

function pickSession(s: TreeSession) {
  if (props.disabled) return;
  if (s.id !== props.currentSessionId) emit("selectSession", s.id);
}
function onCreate(wId: string) {
  if (props.disabled) return;
  emit("createSession", wId);
}
</script>

<template>
  <div class="va-stree" :data-hover-ops="props.hoverOps || undefined">
    <!-- 常驻新建会话（G7）：目标 = 当前工作区 -->
    <button
      v-if="props.newSession"
      class="va-stree__new-session"
      type="button"
      :disabled="props.disabled || !props.currentWorkspaceId"
      :title="props.currentWorkspaceId ? `在「${props.workspaces.find((w) => w.id === props.currentWorkspaceId)?.name ?? ''}」新建会话` : '先选择或新建工作区'"
      @click="onNewSession"
    ><Plus :size="15" aria-hidden="true" />新建会话</button>

    <Transition name="va-stree-pop">
      <div v-if="creatingWs" class="va-stree__ws-create">
      <input
        v-model="wsDraft"
        class="va-stree__input"
        type="text"
        placeholder="本地文件夹路径，如 ~/code/my-proj"
        maxlength="60"
        @keydown.enter.prevent="commitCreateWs"
        @keydown.escape.prevent="cancelCreateWs"
      />
      <button class="va-stree__op" type="button" aria-label="确认创建" @click="commitCreateWs"><Check :size="14" /></button>
      <button class="va-stree__op" type="button" aria-label="取消" @click="cancelCreateWs"><X :size="14" /></button>
    </div>
    </Transition>
    <button
      v-if="!creatingWs"
      class="va-stree__new"
      type="button"
      :disabled="props.disabled"
      @click="startCreateWs"
    ><Plus :size="15" aria-hidden="true" />新建工作区</button>

    <!-- 会话搜索（G9） -->
    <label v-if="props.searchable" class="va-stree__search">
      <Search :size="13" aria-hidden="true" />
      <input v-model="keyword" type="text" placeholder="搜索会话" aria-label="搜索会话" />
    </label>

    <section
      v-for="g in groups"
      :key="g.workspace.id"
      class="va-stree__group"
      :data-current="g.workspace.id === props.currentWorkspaceId || undefined"
    >
      <div class="va-stree__head">
        <button
          v-if="props.collapsible"
          class="va-stree__toggle"
          type="button"
          :aria-label="wsOpen(g.workspace.id) ? `收起 ${g.workspace.name} 的会话` : `展开 ${g.workspace.name} 的会话`"
          @click.stop="toggleWs(g.workspace.id)"
        >
          <ChevronDown v-if="wsOpen(g.workspace.id)" :size="13" aria-hidden="true" />
          <ChevronRight v-else :size="13" aria-hidden="true" />
        </button>
        <span class="va-stree__ws" :title="g.workspace.description || g.workspace.name">
          <span class="va-stree__ws-icon" aria-hidden="true"><FolderClosed :size="14" /></span>
          <span class="va-stree__ws-name">{{ g.workspace.name }}</span>
          <span class="va-stree__count">{{ g.sessions.length }}</span>
          <span v-if="g.workspace.id === props.currentWorkspaceId" class="va-stree__tag">当前</span>
        </span>
        <button class="va-stree__op" type="button" aria-label="在此工作区新建会话" :disabled="props.disabled" @click.stop="onCreate(g.workspace.id)"><Plus :size="14" /></button>
        <button
          class="va-stree__op"
          type="button"
          :data-danger="confirmWsId === g.workspace.id || undefined"
          :aria-label="confirmWsId === g.workspace.id ? '确认删除工作区' : '删除工作区'"
          :disabled="props.disabled"
          @click.stop="askRemoveWorkspace(g.workspace.id)"
        ><span v-if="confirmWsId === g.workspace.id" class="va-stree__confirm">确认?</span><Trash2 v-else :size="13" /></button>
      </div>

      <Transition name="va-stree-fold">
        <div v-if="wsOpen(g.workspace.id)" class="va-stree__list">
          <div class="va-stree__list-clip">
        <div
          v-for="s in g.sessions"
          :key="s.id"
          class="va-stree__session"
          :data-active="s.id === props.currentSessionId || undefined"
        >
          <template v-if="editingId === s.id">
            <input
              v-model="draft"
              class="va-stree__input"
              type="text"
              @keydown.enter.prevent="commitRename"
              @keydown.escape.prevent="cancelRename"
            />
            <button class="va-stree__op" type="button" aria-label="确认重命名" @click="commitRename"><Check :size="14" /></button>
            <button class="va-stree__op" type="button" aria-label="取消" @click="cancelRename"><X :size="14" /></button>
          </template>
          <template v-else>
            <button class="va-stree__session-main" type="button" :title="titleOf(s)" @click="pickSession(s)">
              <span v-if="s.waitingApproval" class="va-stree__dot va-stree__dot--warn" aria-hidden="true" />
              <span v-else-if="s.running" class="va-stree__dot va-stree__dot--run" aria-hidden="true" />
              <Pin v-else-if="s.pinned" class="va-stree__pin" :size="11" aria-hidden="true" />
              <span class="va-stree__session-title">{{ titleOf(s) }}</span>
              <span v-if="s.waitingApproval" class="va-stree__warn-tag">待审批</span>
              <span class="va-stree__time">{{ fmtTime(s.updatedAt) }}</span>
            </button>
            <button class="va-stree__op" type="button" :aria-label="s.pinned ? '取消置顶' : '置顶'" :disabled="props.disabled" @click.stop="emit('togglePin', s.id)">
              <PinOff v-if="s.pinned" :size="13" /><Pin v-else :size="13" />
            </button>
            <button class="va-stree__op" type="button" aria-label="重命名" :disabled="props.disabled" @click.stop="startRename(s)"><Pen :size="13" /></button>
            <button class="va-stree__op" type="button" aria-label="归档" :disabled="props.disabled" @click.stop="emit('archive', s.id, true)"><Archive :size="13" /></button>
            <button
              class="va-stree__op"
              type="button"
              :data-danger="confirmId === s.id || undefined"
              :aria-label="confirmId === s.id ? '确认删除' : '删除'"
              :disabled="props.disabled"
              @click.stop="askRemove(s.id)"
            ><span v-if="confirmId === s.id" class="va-stree__confirm">确认?</span><Trash2 v-else :size="13" /></button>
          </template>
        </div>
        <p v-if="g.sessions.length === 0" class="va-stree__empty">{{ searching ? "无匹配会话" : "暂无会话" }}</p>
          </div>
        </div>
      </Transition>
    </section>

    <p v-if="searching && groups.every((g) => g.sessions.length === 0) && orphans.length === 0" class="va-stree__empty va-stree__search-empty">
      没有匹配「{{ keyword.trim() }}」的会话
    </p>

    <section v-if="orphans.length" class="va-stree__group">
      <div class="va-stree__head">
        <span class="va-stree__ws">
          <span class="va-stree__ws-name">未分组</span>
          <span class="va-stree__count">{{ orphans.length }}</span>
        </span>
      </div>
      <div class="va-stree__list">
        <div class="va-stree__list-clip">
          <div
            v-for="s in orphans"
            :key="s.id"
            class="va-stree__session"
            :data-active="s.id === props.currentSessionId || undefined"
          >
            <template v-if="editingId === s.id">
              <input
                v-model="draft"
                class="va-stree__input"
                type="text"
                @keydown.enter.prevent="commitRename"
                @keydown.escape.prevent="cancelRename"
              />
              <button class="va-stree__op" type="button" aria-label="确认重命名" @click="commitRename"><Check :size="14" /></button>
              <button class="va-stree__op" type="button" aria-label="取消" @click="cancelRename"><X :size="14" /></button>
            </template>
            <template v-else>
              <button class="va-stree__session-main" type="button" :title="titleOf(s)" @click="pickSession(s)">
                <span v-if="s.waitingApproval" class="va-stree__dot va-stree__dot--warn" aria-hidden="true" />
                <span v-else-if="s.running" class="va-stree__dot va-stree__dot--run" aria-hidden="true" />
                <Pin v-else-if="s.pinned" class="va-stree__pin" :size="11" aria-hidden="true" />
                <span class="va-stree__session-title">{{ titleOf(s) }}</span>
                <span v-if="s.waitingApproval" class="va-stree__warn-tag">待审批</span>
                <span class="va-stree__time">{{ fmtTime(s.updatedAt) }}</span>
              </button>
              <button class="va-stree__op" type="button" :aria-label="s.pinned ? '取消置顶' : '置顶'" :disabled="props.disabled" @click.stop="emit('togglePin', s.id)">
                <PinOff v-if="s.pinned" :size="13" /><Pin v-else :size="13" />
              </button>
              <button class="va-stree__op" type="button" aria-label="重命名" :disabled="props.disabled" @click.stop="startRename(s)"><Pen :size="13" /></button>
              <button class="va-stree__op" type="button" aria-label="归档" :disabled="props.disabled" @click.stop="emit('archive', s.id, true)"><Archive :size="13" /></button>
              <button
                class="va-stree__op"
                type="button"
                :data-danger="confirmId === s.id || undefined"
                :aria-label="confirmId === s.id ? '确认删除' : '删除'"
                :disabled="props.disabled"
                @click.stop="askRemove(s.id)"
              ><span v-if="confirmId === s.id" class="va-stree__confirm">确认?</span><Trash2 v-else :size="13" /></button>
            </template>
          </div>
        </div>
      </div>
    </section>

    <div v-if="props.archived.length && !searching" class="va-stree__archived">
      <button class="va-stree__archived-toggle" type="button" @click="archivedOpen = !archivedOpen">
        已归档（{{ props.archived.length }}）
        <ChevronDown v-if="archivedOpen" :size="14" aria-hidden="true" />
        <ChevronRight v-else :size="14" aria-hidden="true" />
      </button>
      <Transition name="va-stree-fold">
        <div v-if="archivedOpen" class="va-stree__list">
          <div class="va-stree__list-clip">
        <div v-for="s in props.archived" :key="s.id" class="va-stree__session" data-archived="true">
          <span class="va-stree__session-main va-stree__session-main--static">
            <span class="va-stree__session-title">{{ titleOf(s) }}</span>
            <span class="va-stree__time">{{ fmtTime(s.updatedAt) }}</span>
          </span>
          <button class="va-stree__op" type="button" aria-label="恢复" :disabled="props.disabled" @click.stop="emit('archive', s.id, false)"><ArchiveRestore :size="13" /></button>
          <button
            class="va-stree__op"
            type="button"
            :data-danger="confirmId === s.id || undefined"
            :aria-label="confirmId === s.id ? '确认删除' : '删除'"
            :disabled="props.disabled"
            @click.stop="askRemove(s.id)"
          ><span v-if="confirmId === s.id" class="va-stree__confirm">确认?</span><Trash2 v-else :size="13" /></button>
        </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 树底部操作区（宿主注入，如设置入口）；flex:1 吃掉剩余高度使 footer 恒沉底 -->
    <footer v-if="$slots.footer" class="va-stree__footer">
      <slot name="footer" />
    </footer>
  </div>
</template>

<style src="./VaSessionTree.css"></style>
