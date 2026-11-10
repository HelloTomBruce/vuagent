<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VaButton,
  VaCheckpointList,
  VaCodeDiff,
  VaCommandMenu,
  VaCommentThread,
  VaDropzone,
  VaEmailDraft,
  VaFileTree,
  VaTerminalLog,
  VaToaster,
  VaUsageMeter,
  buildFileTree,
  vaToaster,
} from "@vuagent/ui";
import type {
  Checkpoint,
  CommandItem,
  CommentItem,
  DropzoneFile,
  FileNode,
} from "@vuagent/ui";

/* ================= 工作台：FileTree + CodeDiff + CheckpointList ================= */

/* agent 的一次变更（扁平 git 变更列表 → 树） */
const CHANGES = [
  { path: "src/components/UserList.tsx", status: "modified" as const },
  { path: "src/hooks/useUsers.ts", status: "modified" as const },
  { path: "src/hooks/useForm.ts", status: "added" as const },
  { path: "src/styles/tokens.css", status: "modified" as const },
  { path: "src/App.tsx", status: "deleted" as const },
  { path: "package.json", status: "modified" as const },
  { path: "README.md", status: "untracked" as const },
];
const tree = buildFileTree(CHANGES);

const selected = ref<string | undefined>("src/hooks/useUsers.ts");

/* 每个文件的旧/新版本（模拟 agent 编辑结果） */
const FILES: Record<string, { oldText: string; newText: string }> = {
  "src/hooks/useUsers.ts": {
    oldText: `import { useEffect, useState } from "react";

export function useUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  return { users, loading };
}`,
    newText: `import { useEffect, useState } from "react";

export function useUsers(page = 1) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetch(\`/api/users?page=\${page}\`, { signal: ac.signal })
      .then((r) => r.json())
      .then(setUsers)
      .catch(setError)
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [page]);

  return { users, loading, error };
}`,
  },
  "src/components/UserList.tsx": {
    oldText: `export function UserList({ users }) {
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
}`,
    newText: `export function UserList({ users, loading }) {
  if (loading) return <Spinner />;
  return (
    <ul className="user-list">
      {users.map((u) => (
        <li key={u.id} className="user-list__item">
          <Avatar name={u.name} />
          <span>{u.name}</span>
        </li>
      ))}
    </ul>
  );
}`,
  },
};
for (const c of CHANGES) {
  if (!FILES[c.path]) {
    // 其余文件给一个小改动，保证点开总有 diff
    FILES[c.path] = {
      oldText: `${c.path}\n（原文件内容示例）\nversion 1\n`,
      newText:
        c.status === "deleted"
          ? ""
          : `${c.path}\n（agent 修改后的内容）\nversion 2 · updated by agent\n`,
    };
  }
}
const currentFile = computed(() => FILES[selected.value ?? ""] ?? { oldText: "", newText: "" });

/* 检查点 */
const checkpoints = ref<Checkpoint[]>([
  { id: "cp3", label: "重命名 UserList props", createdAt: Date.now() - 4 * 60_000, files: 2, additions: 18, deletions: 6 },
  { id: "cp2", label: "引入 AbortController", createdAt: Date.now() - 26 * 60_000, files: 1, additions: 9, deletions: 3, current: true },
  { id: "cp1", label: "初始快照", createdAt: Date.now() - 55 * 60_000, files: 0, additions: 0, deletions: 0 },
]);
const restoring = ref<string | undefined>();
function restore(id: string) {
  restoring.value = id;
  window.setTimeout(() => {
    restoring.value = undefined;
    checkpoints.value = checkpoints.value.map((c) => ({ ...c, current: c.id === id }));
    vaToaster.add({ title: "已恢复检查点", description: checkpoints.value.find((c) => c.id === id)?.label, kind: "success" });
  }, 900);
}
function preview(id: string) {
  const cp = checkpoints.value.find((c) => c.id === id);
  vaToaster.add({ title: "打开 diff 预览", description: `${cp?.label} · +${cp?.additions ?? 0} −${cp?.deletions ?? 0}` });
  selected.value = "src/hooks/useUsers.ts";
}

function onSelect(node: FileNode) {
  vaToaster.add({ title: "打开文件 diff", description: node.path, duration: 2500 });
}

/* ================= 终端输出流 ================= */
const ESC = "\u001b";
const termLines = [
  { text: "pnpm build", kind: "cmd" as const },
  "> vuagent-demo@0.1.0 build /workspace",
  "> vite build",
  "",
  "vite v7.3.7 building for production...",
  `${ESC}[2m✓${ESC}[22m 42 modules transformed.`,
  `dist/index.js                 512.40 kB │ ${ESC}[32mgzip: 158.11 kB${ESC}[39m`,
  `${ESC}[1mdist/styles.css${ESC}[22m              38.02 kB │ ${ESC}[32mgzip:  6.74 kB${ESC}[39m`,
  `${ESC}[33m(!) Some chunks are larger than 500 kB after minification.${ESC}[39m`,
  `${ESC}[32m✓ built in 1.42s${ESC}[39m`,
];

/* ================= 命令面板 ================= */
const cmdOpen = ref(false);
const commands: CommandItem[] = [
  { id: "run", label: "运行测试", group: "常用", hint: "⌘T" },
  { id: "build", label: "构建项目", group: "常用", hint: "⌘B" },
  { id: "commit", label: "提交变更", group: "常用", keywords: "git commit 提交" },
  { id: "checkpoint", label: "创建检查点", group: "Agent", keywords: "snapshot 快照" },
  { id: "revert", label: "回滚到上一检查点", group: "Agent", keywords: "恢复 回滚" },
  { id: "explain", label: "解释这次 diff", group: "Agent" },
  { id: "clear", label: "清空终端输出", group: "其他" },
  { id: "settings", label: "打开设置", group: "其他", disabled: true },
  { id: "delete", label: "删除工作区（危险）", group: "其他", danger: true },
];
function onCommand(item: CommandItem) {
  vaToaster.add({ title: `执行：${item.label}`, description: item.danger ? "危险操作已拦截（demo）" : undefined, kind: item.danger ? "danger" : "info" });
}

/* ================= 用量 ================= */
const usageSegs = [
  { label: "Fast tokens", used: 412_000 },
  { label: "Slow tokens", used: 168_500 },
  { label: "工具调用", used: 92_300 },
];
const usageLimit = ref(800_000);
function bumpUsage() {
  usageLimit.value = usageLimit.value; // 保持
  usageSegs[0]!.used = Math.min(usageLimit.value, usageSegs[0]!.used + 120_000);
  vaToaster.add({ title: "模拟一轮任务消耗", kind: "info" });
}
const usageSpike = ref(false);

/* ================= 评论 + 邮件 + 上传 ================= */
const comments = ref<CommentItem[]>([
  { id: "c1", author: "张北", role: "工程师", text: "分页参数建议从 URL search params 取，刷新不丢状态。", createdAt: Date.now() - 40 * 60_000 },
  {
    id: "c2",
    author: "Agent",
    role: "Agent",
    pending: true,
    text: "建议把 useUsers 的 fetch 换成 React Query：自动缓存与重试，还能顺手去掉手写的 AbortController。要我一并改掉吗？",
    createdAt: Date.now() - 2 * 60_000,
  },
]);
function submitComment(text: string) {
  comments.value = [...comments.value, { id: `c${comments.value.length + 1}`, author: "张北", role: "工程师", text, createdAt: Date.now() }];
}
function adopt(id: string) {
  comments.value = comments.value.map((c) => (c.id === id ? { ...c, pending: false } : c));
  vaToaster.add({ title: "草稿已发布", kind: "success" });
}
function rewrite(id: string) {
  const c = comments.value.find((x) => x.id === id);
  vaToaster.add({ title: "让 agent 重写草稿…", description: c?.text.slice(0, 24) });
  window.setTimeout(() => {
    comments.value = comments.value.map((x) =>
      x.id === id ? { ...x, text: "换个思路：先加 SWR 做数据层，AbortController 交给库管理，组件只消费 hooks。", pending: true } : x,
    );
  }, 1000);
}
function discard(id: string) {
  comments.value = comments.value.filter((c) => c.id !== id);
}

/* 邮件草稿 */
const mail = ref({ to: "ops@fastech.com", subject: "用户列表页重构完成，请审阅", body: "Hi 团队，\n\n用户列表页重构完成：\n· 分页 + 取消请求（AbortController）\n· 加载骨架与错误兜底\n· 检查点已存，可随时回滚\n\n构建通过（1.42s），详见附件。\n\n—— 由 agent 起草" });
const mailDrafting = ref(false);
const mailSending = ref(false);
const tones = [
  { value: "concise", label: "简洁" },
  { value: "formal", label: "正式" },
  { value: "friendly", label: "友好" },
];
const tone = ref("concise");
function regenerateMail() {
  mailDrafting.value = true;
  window.setTimeout(() => {
    mail.value.subject = "【审阅】用户列表页重构完成";
    mailDrafting.value = false;
  }, 1200);
}
function sendMail(d: { to: string; subject: string; body: string }) {
  mailSending.value = true;
  window.setTimeout(() => {
    mailSending.value = false;
    vaToaster.add({ title: "邮件已发送", description: `${d.to} · ${d.subject}`, kind: "success" });
  }, 1000);
}

/* 上传 */
const uploads = ref<DropzoneFile[]>([]);
const rejectNote = ref("");
function onAdd(files: File[]) {
  for (const f of files) {
    const id = `f${Date.now()}-${f.name}`;
    uploads.value = [...uploads.value, { id, name: f.name, size: f.size, progress: 0 }];
    let p = 0;
    const timer = window.setInterval(() => {
      p = Math.min(100, p + 8 + Math.random() * 18);
      const row = uploads.value.find((x) => x.id === id);
      if (row) row.progress = p;
      if (p >= 100) {
        window.clearInterval(timer);
        const done = uploads.value.find((x) => x.id === id);
        if (done) done.status = "done";
      }
    }, 220);
  }
}
function onRemove(id: string) {
  uploads.value = uploads.value.filter((f) => f.id !== id);
}
</script>

<template>
  <div class="m5">
    <VaToaster />
    <p class="m5__lead">
      场景：agent 完成一轮代码修改，你在验收工作台上检查 diff、跑构建、回滚检查点，最后让 agent 起草通知邮件。
      <VaButton size="sm" variant="secondary" style="margin-left: 8px" @click="bumpUsage">模拟一轮消耗</VaButton>
      <VaButton size="sm" variant="secondary" style="margin-left: 8px" @click="usageSpike = !usageSpike">
        {{ usageSpike ? "恢复正常用量" : "切到超限态" }}
      </VaButton>
    </p>

    <div class="m5__grid">
      <!-- 左列：文件树 + 检查点 -->
      <section class="m5__panel">
        <h3>File Tree · 变更列表（M/A/D/U，方向键可导航）</h3>
        <VaFileTree v-model:selected="selected" :tree="tree" title="agent 变更 · 7 个文件" :max-height="280" @select="onSelect" />
        <h3 style="margin-top: 18px">Checkpoint List · 回滚（恢复需二次确认）</h3>
        <VaCheckpointList :checkpoints="checkpoints" :restoring="restoring" @restore="restore" @preview="preview" />
      </section>

      <!-- 右列：diff + 终端 -->
      <section class="m5__panel">
        <h3>Code Diff · {{ selected ?? "未选择文件" }}（行内词级高亮 + 折叠上下文）</h3>
        <VaCodeDiff
          :file-name="selected"
          :old-text="currentFile.oldText"
          :new-text="currentFile.newText"
          :context="2"
          :max-height="330"
        />
        <h3 style="margin-top: 18px">Terminal Log · 构建输出（ANSI 着色 + 自动滚动）</h3>
        <VaTerminalLog title="bash — pnpm build" :lines="termLines" :max-height="220" show-line-numbers />
      </section>

      <!-- 第三行 -->
      <section class="m5__panel">
        <h3>Command Menu · ⌘K（↑↓ 导航 / Enter 选中 / Esc 关闭）</h3>
        <VaCommandMenu
          v-model:open="cmdOpen"
          :commands="commands"
          hotkey="⌘K"
          trigger-label="命令面板"
          placeholder="搜索命令，如「回滚」「测试」…"
          @select="onCommand"
        />
        <h3 style="margin-top: 18px">Usage Meter · 用量与限额</h3>
        <VaUsageMeter
          :segments="usageSpike ? [{ label: 'Fast tokens', used: 640_000 }, { label: 'Slow tokens', used: 180_000 }] : usageSegs"
          :limit="usageLimit"
          unit="tokens"
          period="今日 · 明早 8 点重置"
          @manage="() => vaToaster.add({ title: '跳转额度管理（demo）' })"
        />
      </section>

      <section class="m5__panel">
        <h3>Comment Thread · agent 草稿待审（⌘/Ctrl+Enter 发布）</h3>
        <VaCommentThread :comments="comments" :max-height="300" @submit="submitComment" @adopt="adopt" @rewrite="rewrite" @discard="discard" />
      </section>

      <section class="m5__panel">
        <h3>Email Draft · agent 起草、人工确认</h3>
        <VaEmailDraft
          v-model:to="mail.to"
          v-model:subject="mail.subject"
          v-model:body="mail.body"
          v-model:tone="tone"
          :tones="tones"
          :drafting="mailDrafting"
          :sending="mailSending"
          @send="sendMail"
          @regenerate="regenerateMail"
        />
      </section>

      <section class="m5__panel">
        <h3>Dropzone · 附件上传（拖入或点击；超 10MB 拒绝）</h3>
        <VaDropzone
          :files="uploads"
          multiple
          accept="image/*,.pdf,.zip"
          :max-size-mb="10"
          label="把构建产物或截图拖到这里"
          @add="onAdd"
          @remove="onRemove"
          @reject="(fs) => { rejectNote = `${fs.length} 个文件超过 10MB 被拒绝`; vaToaster.add({ title: '文件过大', description: rejectNote, kind: 'warning' }); }"
        />
        <p v-if="rejectNote" class="m5__note">{{ rejectNote }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.m5 { display: flex; flex-direction: column; gap: 16px; }
.m5__lead { margin: 0; font-size: 13px; color: var(--va-muted, #6f6d66); line-height: 1.7; }
.m5__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; align-items: start; }
.m5__panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  min-width: 0;
}
.m5__panel h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--va-muted, #6f6d66);
}
.m5__note { margin: 10px 0 0; font-size: 12px; color: var(--va-warning, #b45309); }
</style>
