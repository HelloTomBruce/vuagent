/**
 * 内置工具启停 + 配置中心数据域（TASK-020/028 逻辑自 Console.vue 平移，TASK-043 收敛）
 * - tools：/api/tools 拉取 + 行内启停（乐观翻转，PATCH 失败回滚并 toast，服务端为真值来源）
 * - config：/api/config 拉取 + 字段 patch + 整命名空间 reset（乐观更新，以服务端生效值为准）
 * - security.defaultPermissionMode 变更同步宿主权限档（defaultPermission 必同步；
 *   activePermission 仅新建会话态同步——活跃会话的权限档不被动改写）
 */
import { ref } from "vue";
import type { Ref } from "vue";
import { getConfig, listTools, patchConfig, patchToolEnabled, resetConfig } from "../api/client";
import type { ConfigNamespace, ToolItem } from "../api/client";
import { vaToaster } from "@vuagent/ui";

export interface ConsoleToolsConfigOptions {
  /** 权限档状态（宿主所有）：security.defaultPermissionMode 的同步目标 */
  defaultPermission: Ref<string>;
  activePermission: Ref<string>;
  /** 新建会话态：fetchConfig 同步时才允许改写 activePermission */
  isNewChat: Ref<boolean>;
}

export function useConsoleToolsConfig(perm: ConsoleToolsConfigOptions) {
  /* ==========================================================================
     内置工具启停（TASK-020）：/api/tools 拉取 + PATCH 提交
     乐观更新：先翻转本地开关即时反馈，PATCH 失败回滚并 toast 提示
     ========================================================================== */
  const tools = ref<ToolItem[]>([]);
  const toolsLoading = ref(false);
  const toolsError = ref("");

  async function fetchTools() {
    toolsLoading.value = true;
    toolsError.value = "";
    try {
      const list = await listTools();
      if (list === null) {
        toolsError.value = "工具清单加载失败，请检查服务端连接后重试";
        return;
      }
      tools.value = list;
    } catch (e) {
      console.error("拉取工具清单失败:", e);
      toolsError.value = "工具清单加载失败，请检查服务端连接后重试";
    } finally {
      toolsLoading.value = false;
    }
  }

  /** 行内启停：乐观翻转 → PATCH 确认；失败按原值回滚并 toast（服务端为真值来源） */
  async function onToggleTool(tool: ToolItem) {
    const next = !tool.enabled;
    const prev = tool.enabled;
    tool.enabled = next;
    try {
      const confirmed = await patchToolEnabled(tool.name, next);
      if (!confirmed) {
        tool.enabled = prev;
        vaToaster.add({
          title: "工具启停保存失败",
          description: `${tool.name} 的状态未能持久化，已恢复原状态`,
          kind: "danger",
        });
        return;
      }
      // 以服务端落库结果为准（防并发写覆盖）
      tool.enabled = confirmed.enabled;
      vaToaster.add({
        title: confirmed.enabled ? `已启用 ${tool.name}` : `已停用 ${tool.name}`,
        kind: "success",
      });
    } catch (e) {
      tool.enabled = prev;
      console.error("工具启停提交失败:", e);
      vaToaster.add({
        title: "工具启停保存失败",
        description: e instanceof Error ? e.message : String(e),
        kind: "danger",
      });
    }
  }

  /* ==========================================================================
     配置中心（TASK-028）：/api/config 拉取 + 乐观更新 + reset
     面板为 schema 驱动通用组件（ConfigPanel），此处只做数据编排；
     security.defaultPermissionMode 改动同步到新建会话缺省档。
     ========================================================================== */
  const configNamespaces = ref<ConfigNamespace[]>([]);
  const configLoading = ref(false);
  const configError = ref("");

  function configNs(id: string): ConfigNamespace | null {
    return configNamespaces.value.find((n) => n.id === id) ?? null;
  }

  async function fetchConfig() {
    configLoading.value = true;
    configError.value = "";
    try {
      const cfg = await getConfig();
      if (cfg === null) {
        configError.value = "配置加载失败，请检查服务端连接后重试";
        return;
      }
      configNamespaces.value = cfg.namespaces;
      // 新建会话缺省权限模式 ← security.defaultPermissionMode（TASK-026）
      const configuredMode = configNs("security")?.values?.defaultPermissionMode;
      if (typeof configuredMode === "string" && configuredMode) {
        perm.defaultPermission.value = configuredMode;
        if (perm.isNewChat.value) perm.activePermission.value = configuredMode;
      }
    } catch (e) {
      console.error("拉取配置中心失败:", e);
      configError.value = "配置加载失败，请检查服务端连接后重试";
    } finally {
      configLoading.value = false;
    }
  }

  /** 字段修改：乐观写入 → PATCH 确认（以服务端生效值为准，含钳制/截断）；失败按原值回滚并 toast */
  async function onConfigPatch(nsId: string, key: string, value: unknown) {
    const ns = configNs(nsId);
    if (!ns) return;
    const prev = ns.values[key];
    ns.values[key] = value;
    try {
      const res = await patchConfig(nsId, { [key]: value });
      if (!res) {
        ns.values[key] = prev;
        vaToaster.add({
          title: "配置保存失败",
          description: "服务端拒绝了本次修改（字段可能被 env 锁定），已恢复原值",
          kind: "danger",
        });
        return;
      }
      ns.values = res.values;
      ns.isDefault = false;
      if (nsId === "security" && typeof res.values.defaultPermissionMode === "string") {
        perm.defaultPermission.value = res.values.defaultPermissionMode;
      }
    } catch (e) {
      ns.values[key] = prev;
      console.error("配置提交失败:", e);
      vaToaster.add({
        title: "配置保存失败",
        description: e instanceof Error ? e.message : String(e),
        kind: "danger",
      });
    }
  }

  /** 恢复默认：整命名空间 reset，生效值以服务端返回为准 */
  async function onConfigReset(nsId: string) {
    const ns = configNs(nsId);
    if (!ns) return;
    try {
      const res = await resetConfig(nsId);
      if (!res) {
        vaToaster.add({ title: "恢复默认失败", description: "请检查服务端连接后重试", kind: "danger" });
        return;
      }
      ns.values = res.values;
      ns.isDefault = true;
      if (nsId === "security" && typeof res.values.defaultPermissionMode === "string") {
        perm.defaultPermission.value = res.values.defaultPermissionMode;
      }
      vaToaster.add({ title: `已恢复「${ns.title}」默认配置`, kind: "success" });
    } catch (e) {
      console.error("配置 reset 失败:", e);
      vaToaster.add({
        title: "恢复默认失败",
        description: e instanceof Error ? e.message : String(e),
        kind: "danger",
      });
    }
  }

  return {
    // tools
    tools,
    toolsLoading,
    toolsError,
    fetchTools,
    onToggleTool,
    // config
    configNamespaces,
    configLoading,
    configError,
    configNs,
    fetchConfig,
    onConfigPatch,
    onConfigReset,
  };
}

export type ConsoleToolsConfigApi = ReturnType<typeof useConsoleToolsConfig>;
