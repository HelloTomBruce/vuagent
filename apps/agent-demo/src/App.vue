<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  VaAppShell,
  VaButton,
  VaCommandMenu,
  VaProfileMenu,
  VaToaster,
  vaToaster,
} from "@vuagent/ui";
import type { CommandItem } from "@vuagent/ui";
import { useAgentEngine } from "./engine/useAgentEngine";

const router = useRouter();
const route = useRoute();
const { state, dispatch } = useAgentEngine();

const theme = ref<"light" | "dark">("light");
function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme.value;
}

/* ---------- 全局 ⌘K ---------- */
const cmdOpen = ref(false);
const commands: CommandItem[] = [
  { id: "go-chat", label: "去对话", group: "导航", hint: "⌘1" },
  { id: "go-tasks", label: "去任务", group: "导航", hint: "⌘2" },
  { id: "go-insights", label: "去洞察", group: "导航", hint: "⌘3" },
  { id: "go-settings", label: "去设置", group: "导航", hint: "⌘4" },
  { id: "run-report", label: "生成周报", group: "剧本", keywords: "周报 weekly" },
  { id: "run-refactor", label: "重构用户列表页（走审批门）", group: "剧本", keywords: "重构 refactor" },
  { id: "run-analysis", label: "分析任务数据", group: "剧本", keywords: "分析 数据" },
  { id: "toggle-theme", label: "切换亮暗主题", group: "其他" },
];
function onCommand(item: CommandItem) {
  if (item.id.startsWith("go-")) {
    router.push({ name: item.id.slice(3) });
    return;
  }
  if (item.id === "toggle-theme") {
    toggleTheme();
    return;
  }
  router.push("/chat");
  const text = item.id === "run-report" ? "生成周报" : item.id === "run-refactor" ? "重构用户列表页" : "分析任务数据";
  vaToaster.add({ title: `执行剧本：${item.label}`, kind: "info" });
  void dispatch(text);
}
function onHotkey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    cmdOpen.value = !cmdOpen.value;
  }
}
onMounted(() => window.addEventListener("keydown", onHotkey));
onBeforeUnmount(() => window.removeEventListener("keydown", onHotkey));

router.afterEach((to) => {
  if (to.meta.title && typeof document !== "undefined") document.title = `Vuagent · ${String(to.meta.title)}`;
});

const unread = () => state.notifications.filter((n) => n.unread).length;
</script>

<template>
  <VaAppShell
    v-model:active="$route.name as string"
    brand="Vuagent Assistant"
    :nav="[
      { id: 'chat', label: '对话' },
      { id: 'tasks', label: '任务', badge: state.tasks.filter(t => t.status === 'running').length || undefined },
      { id: 'insights', label: '洞察' },
      { id: 'settings', label: '设置', badge: unread() || undefined },
    ]"
    style="height: 100vh"
    @navigate="(item) => router.push({ name: item.id })"
  >
    <template #topbar>
      <span class="demo-hint">通用助手 demo · 输入「生成周报 / 重构 / 分析」触发剧本 · ⌘K 命令面板</span>
      <span style="flex: 1" />
      <VaCommandMenu
        v-model:open="cmdOpen"
        :commands="commands"
        hotkey="⌘K"
        trigger-label="命令"
        @select="onCommand"
      />
      <VaButton variant="secondary" size="sm" style="margin-left: 8px" @click="toggleTheme">
        {{ theme === "light" ? "🌙" : "☀️" }}
      </VaButton>
      <VaProfileMenu
        style="margin-left: 8px"
        name="张北"
        email="zhangbei@fastech.com"
        :badge="unread()"
        :items="[
          { id: 'insights', label: '我的数据' },
          { id: 'settings', label: '账户设置' },
          { id: 'logout', label: '退出登录', danger: true },
        ]"
        @select="(i) => i.id !== 'logout' ? router.push({ name: i.id }) : vaToaster.add({ title: '已退出（demo）', kind: 'info' })"
      />
    </template>

    <VaToaster />
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="String(route.path)" />
    </RouterView>
  </VaAppShell>
</template>

<style>
body { margin: 0; }
.demo-hint {
  font-size: 12px;
  color: var(--va-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
