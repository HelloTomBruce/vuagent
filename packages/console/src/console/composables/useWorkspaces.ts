/**
 * 工作区数据域：列表 / 系统选目录创建 / 删除 / 展开折叠
 * 从原 Console.vue 工作区相关逻辑平移，行为保持一致
 */
import { computed, ref } from "vue";
import {
  createWorkspace,
  deleteWorkspaceById,
  listWorkspaces,
  pickDirectory,
} from "../api/client";
import { vaConfirm, vaToaster } from "@vuagent/ui";
import { askText } from "./useTextPrompt";
import type { WorkspaceItem } from "../types";

export interface WorkspacesOptions {
  /** 打开系统选目录前关闭下拉菜单（原 pickAndCreateWorkspace 首行 closeAllMenus） */
  closeMenus?: () => void;
  /** 删除工作区后刷新会话列表（原 deleteWorkspace 尾部 fetchSessions） */
  refreshSessions?: () => Promise<void>;
  /** 选中/创建工作区后回调（原 startNewChat） */
  onWorkspaceActivated?: () => void;
  /** 工作区下拉菜单收起（原 selectWorkspace 内 isWorkspaceMenuOpen=false） */
  closeWorkspaceMenu?: () => void;
}

export function useWorkspaces(options: WorkspacesOptions = {}) {
  const workspaces = ref<WorkspaceItem[]>([]);
  const activeWorkspaceId = ref("");

  const currentWorkspace = computed(() => {
    return (
      workspaces.value.find((w) => w.id === activeWorkspaceId.value) ||
      workspaces.value[0] ||
      null
    );
  });

  async function fetchWorkspaces() {
    try {
      const data = await listWorkspaces();
      if (data) {
        workspaces.value = data;
        if (workspaces.value.length > 0 && !activeWorkspaceId.value) {
          activeWorkspaceId.value = workspaces.value[0].id;
        }
      }
    } catch (e) {
      console.error("加载工作区失败:", e);
    }
  }

  function activateWorkspace(wsId: string) {
    activeWorkspaceId.value = wsId;
    options.onWorkspaceActivated?.();
  }

  /**
   * 调起系统原生文件夹选择器。
   * - 取消：静默返回（0.7.1 之前会把取消当失败，进而弹出「手动输入路径」）；
   * - 忙碌：提示先完成已打开的选择框；
   * - 不可用：给出原因 + 可执行提示，手动输入作为**显式兜底**（并在描述里带上原因）。
   */
  async function pickAndCreateWorkspace() {
    options.closeMenus?.();
    const outcome = await pickDirectory();

    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "busy") {
      vaToaster.add({ title: "选择框已打开", description: outcome.error, kind: "warning" });
      return;
    }
    if (outcome.kind === "picked") {
      await fetchWorkspaces();
      if (outcome.workspace.id) activateWorkspace(outcome.workspace.id);
      return;
    }

    console.warn("系统文件夹选择框不可用:", outcome.error);
    vaToaster.add({
      title: "无法打开系统文件夹选择框",
      description: outcome.hint ? `${outcome.error}——${outcome.hint}` : outcome.error,
      kind: "warning",
    });
    // 手动输入兜底：把「为什么退到这里」写清楚，不让它看起来像默认交互
    const manualPath = await askText({
      title: "手动输入工作区路径",
      description: `${outcome.error}${outcome.hint ? `（${outcome.hint}）` : ""}\n也可以直接输入本地项目文件夹的绝对路径。`,
      placeholder: "/Users/username/project",
      confirmText: "创建",
    });
    if (!manualPath?.trim()) return;

    try {
      const newWs = await createWorkspace({
        // 跨平台取目录名：POSIX 的 / 与 Windows 的 \ 都要能切
        name: manualPath.trim().split(/[\\/]/).filter(Boolean).pop() || "workspace",
        rootPath: manualPath.trim(),
        permission: "read-write",
      });
      if (newWs) {
        await fetchWorkspaces();
        activateWorkspace(newWs.id);
      }
    } catch (e) {
      vaToaster.add({
        title: "创建工作区失败",
        description: String(e),
        kind: "danger",
      });
    }
  }

  function selectWorkspace(wsId: string) {
    activeWorkspaceId.value = wsId;
    options.closeWorkspaceMenu?.();
  }

  /** 删除工作区：vaConfirm 模态确认（danger tone），确认后才发删除请求（工作区内全部会话随之删除） */
  async function askDeleteWorkspace(wsId: string) {
    const target = workspaces.value.find((w) => w.id === wsId);
    const ok = await vaConfirm({
      title: "删除这个工作区？",
      description: `「${target?.name || "未命名工作区"}」及其下的全部会话将被删除，此操作不可撤销。`,
      confirmText: "删除",
      tone: "danger",
      icon: true,
    });
    if (ok) await deleteWorkspace(wsId);
  }

  async function deleteWorkspace(wsId: string) {
    try {
      const res = await deleteWorkspaceById(wsId);
      if (res) {
        workspaces.value = workspaces.value.filter((w) => w.id !== wsId);
        if (activeWorkspaceId.value === wsId) {
          activeWorkspaceId.value = workspaces.value[0]?.id || "";
        }
        await options.refreshSessions?.();
      }
    } catch (e) {
      console.error("删除工作区失败:", e);
    }
  }

  /** handleSend 前置校验：确保有可用工作区，无则引导创建（原 handleSend 首段） */
  async function ensureActiveWorkspace(): Promise<boolean> {
    if (!activeWorkspaceId.value) {
      if (workspaces.value.length > 0) {
        activeWorkspaceId.value = workspaces.value[0].id;
      } else {
        await pickAndCreateWorkspace();
        if (!activeWorkspaceId.value) return false;
      }
    }
    return true;
  }

  return {
    workspaces,
    activeWorkspaceId,
    currentWorkspace,
    fetchWorkspaces,
    pickAndCreateWorkspace,
    /** 激活工作区并触发新会话（空态引导卡/侧栏共用） */
    activateWorkspace,
    selectWorkspace,
    askDeleteWorkspace,
    deleteWorkspace,
    ensureActiveWorkspace,
  };
}
