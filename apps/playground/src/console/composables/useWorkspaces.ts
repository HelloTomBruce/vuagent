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
import { useDoubleConfirm } from "./useDoubleConfirm";
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
  const expandedWorkspaces = ref<Set<string>>(new Set());
  const { confirmId: confirmDeleteWorkspaceId, ask: askConfirm } =
    useDoubleConfirm();

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
    expandedWorkspaces.value.add(wsId);
    options.onWorkspaceActivated?.();
  }

  /** 调起系统原生文件夹选择器；失败降级为手动输入路径（原实现逐行平移） */
  async function pickAndCreateWorkspace() {
    options.closeMenus?.();
    try {
      const data = await pickDirectory();
      if (!data) {
        throw new Error("系统选择框调用失败");
      }
      if (data.cancelled) return;
      await fetchWorkspaces();
      if (data.id) activateWorkspace(data.id);
    } catch (err) {
      console.warn("系统文件夹选择降级:", err);
      const manualPath = prompt(
        "请输入本地项目文件夹路径 (如 /Users/username/project):"
      );
      if (manualPath && manualPath.trim()) {
        try {
          const newWs = await createWorkspace({
            name: manualPath.split("/").filter(Boolean).pop() || "workspace",
            rootPath: manualPath.trim(),
            permission: "read-write",
          });
          if (newWs) {
            await fetchWorkspaces();
            activateWorkspace(newWs.id);
          }
        } catch (e) {
          alert("创建工作区失败: " + e);
        }
      }
    }
  }

  function toggleWorkspaceExpand(wsId: string) {
    if (expandedWorkspaces.value.has(wsId)) {
      expandedWorkspaces.value.delete(wsId);
    } else {
      expandedWorkspaces.value.add(wsId);
    }
  }

  function selectWorkspace(wsId: string) {
    activeWorkspaceId.value = wsId;
    expandedWorkspaces.value.add(wsId);
    options.closeWorkspaceMenu?.();
  }

  function askDeleteWorkspace(wsId: string, event: Event) {
    event.stopPropagation();
    askConfirm(wsId, () => deleteWorkspace(wsId));
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
    expandedWorkspaces,
    currentWorkspace,
    confirmDeleteWorkspaceId,
    fetchWorkspaces,
    pickAndCreateWorkspace,
    toggleWorkspaceExpand,
    /** 激活工作区并触发新会话（空态引导卡/侧栏共用） */
    activateWorkspace,
    selectWorkspace,
    askDeleteWorkspace,
    deleteWorkspace,
    ensureActiveWorkspace,
  };
}
