/**
 * 会话数据域：列表 / 历史 Turn 解包 / 断线重连选会话 / 重命名 / 归档 / 删除
 * 从原 Console.vue 会话逻辑平移；聊天流状态通过注入的 chat (ChatStreamApi) 协作
 */
import { computed, ref } from "vue";
import type { Ref } from "vue";
import {
  createSessionApi,
  deleteSessionById,
  getSessionDetail,
  listSessions,
  patchSession,
} from "../api/client";
import { rebuildBlocksFromHistory } from "../stream/blocks";
import { vaConfirm } from "@vuagent/ui";
import type { ChatStreamApi } from "./useChatStream";
import type { ScrollToBottomOptions } from "@vuagent/ui";
import type { MessageTurn, SessionItem } from "../types";

export interface SessionsOptions {
  chat: ChatStreamApi;
  isNewChat: Ref<boolean>;
  activeWorkspaceId: Ref<string>;
  /** 当前会话绑定的权限模式（切换会话时从 session.permission 恢复） */
  activePermission: Ref<string>;
  /** 种子消息里展示的工作区路径（原 currentWorkspace.value?.rootPath） */
  getWorkspaceRootPath: () => string;
  /** 切换会话/加载历史后用 { force: true } 强制回底 */
  scrollToBottom: (options?: ScrollToBottomOptions) => void;
  /** 删除的是当前激活会话时回调（原 startNewChat） */
  onActiveDeleted: () => void;
}

export function useSessions(options: SessionsOptions) {
  const { chat } = options;

  const sessions = ref<SessionItem[]>([]);
  const activeSessionId = ref("");

  const activeSessions = computed(() => {
    return sessions.value.filter((s) => !s.archived && s.status !== "archived");
  });

  const archivedSessions = computed(() => {
    return sessions.value.filter((s) => s.archived || s.status === "archived");
  });

  async function fetchSessions() {
    try {
      const data = await listSessions();
      if (data) {
        sessions.value = data;
      }
    } catch (e) {
      console.error("加载会话失败:", e);
    }
  }

  /** 新会话首条消息时创建服务端会话记录（原 handleSend 的会话创建段） */
  async function createSessionForPrompt(payload: {
    workspaceId: string;
    title: string;
    activeModelProfileId?: string;
    permission?: string;
  }): Promise<SessionItem | null> {
    try {
      const newSess = await createSessionApi(payload);
      if (newSess) {
        sessions.value.unshift(newSess);
        activeSessionId.value = newSess.id;
      }
      return newSess;
    } catch (e) {
      console.error("创建会话记录失败:", e);
      return null;
    }
  }

  /**
   * 切换会话：本地缓存秒级恢复 → 服务端历史解包 → 活跃运行时断点重连
   * 与原实现逐行对应
   */
  async function selectSession(session: SessionItem) {
    // 1. 切换前暂存当前离开会话的视图消息，防止会话切换状态丢失
    if (activeSessionId.value && chat.chatTurns.value.length > 0) {
      chat.sessionTurnsCache.set(activeSessionId.value, [...chat.chatTurns.value]);
    }

    activeSessionId.value = session.id;
    options.activeWorkspaceId.value = session.workspaceId;
    options.isNewChat.value = false;
    // 权限模式随会话恢复，避免跨会话互相影响
    options.activePermission.value = session.permission || "review";
    chat.planSteps.value = [];
    // 先归零上下文仪表，随后由历史 telemetry 水合（或运行时 usage 事件覆盖），
    // 避免残留上一个会话的数值
    chat.contextUsed.value = 0;

    const isCurrentlyStreaming = Boolean(chat.sessionRunningMap.get(session.id));

    // 2. 若本地内存中已有该会话且正在流式输出，直接秒级恢复！
    if (chat.sessionTurnsCache.has(session.id) && isCurrentlyStreaming) {
      chat.chatTurns.value = chat.sessionTurnsCache.get(session.id)!;
      chat.isRunning.value = true;
      chat.activeAbortController.value =
        chat.sessionAbortControllers.get(session.id) || null;
      // 切换到正在流式的会话：强制回底
      options.scrollToBottom({ force: true });
      return;
    }

    // 3. 从服务端加载会话历史与运行态
    try {
      const detail = await getSessionDetail(session.id);
      if (detail) {
        const unpacked: MessageTurn[] = [];

        if (detail.turns && detail.turns.length > 0) {
          for (const t of detail.turns) {
            if (t.role) {
              unpacked.push({
                id: t.id || `turn-${Date.now()}`,
                role: t.role,
                content: t.content || "",
                thought: t.thought || "",
                thoughtExpanded: false,
                thoughtDuration: t.thoughtDuration || 0,
                cards: t.cards || [],
                timestamp: t.timestamp || Date.now(),
              });
            } else {
              // 用最后一个带 contextTokens 的 turn 水合上下文仪表
              // （该值为本 turn 最后一步的真实窗口占用；旧数据无此字段则保持 0）
              const ctxTokens = t.telemetry?.contextTokens;
              if (typeof ctxTokens === "number" && ctxTokens > 0) {
                chat.contextUsed.value = ctxTokens;
              }

              if (t.prompt) {
                unpacked.push({
                  id: `turn-user-${t.id}`,
                  role: "user",
                  content: t.prompt,
                  timestamp: t.createdAt || Date.now(),
                });
              }

              let asstContent = t.content;
              if (!asstContent && t.checkpoints && t.checkpoints.length > 0) {
                const lastCp = t.checkpoints[t.checkpoints.length - 1];
                if (lastCp && Array.isArray(lastCp.messagesSnapshot)) {
                  const found = [...lastCp.messagesSnapshot]
                    .reverse()
                    .find((m: any) => m.role === "assistant" && m.content);
                  if (found) asstContent = found.content;
                }
              }
              if (!asstContent) {
                if (t.status === "error") {
                  asstContent = "⚠️ *(此轮执行遇到错误或被中止)*";
                } else {
                  asstContent = `*(本轮任务已执行完毕${t.telemetry?.durationMs ? `，耗时 ${Math.round(t.telemetry.durationMs / 100) / 10}s` : ""})*`;
                }
              }

              // TASK-006 兜底：轮次已结束但 toolcall 卡仍停留 running 态（执行中被中止），
              // 收敛为 error 防止 VaToolCallCard 计时器永远空转
              const restoredCards = (t.cards || []).map((c: any) => {
                if (
                  c.type === "toolcall" &&
                  (c.data?.status === "streaming" || c.data?.status === "executing")
                ) {
                  return {
                    ...c,
                    data: { ...c.data, status: "error", error: "执行被中止" },
                  };
                }
                return c;
              });

              unpacked.push({
                id: `turn-asst-${t.id}`,
                role: "assistant",
                content: asstContent,
                thought: t.thought || "",
                thoughtExpanded: false,
                thoughtDuration: t.telemetry?.durationMs
                  ? Math.round(t.telemetry.durationMs / 100) / 10
                  : 0,
                cards: restoredCards,
                // 按 contentOffset 重建输出时序块（审批卡回到发生位置）
                blocks: rebuildBlocksFromHistory(asstContent, restoredCards),
                // 恢复三泳道轨迹（落库时 detail/result 已截断）
                trajEvents: (t.telemetry?.events as MessageTurn["trajEvents"]) || [],
                timestamp: t.completedAt || t.createdAt || Date.now(),
              });

              if (t.plan?.steps) {
                chat.planSteps.value = t.plan.steps;
              }
            }
          }
        }


        // 4. 服务端此会话正处于活跃运行态（支持刷新页面后断点重连继续输出）
        if (detail.isRunning) {
          chat.sessionRunningMap.set(session.id, true);
          chat.isRunning.value = true;

          const activePrompt = detail.activeRun?.prompt || "正在后台执行的任务…";
          unpacked.push({
            id: `turn-user-live-${Date.now()}`,
            role: "user",
            content: activePrompt,
            timestamp: detail.activeRun?.startedAt || Date.now(),
          });

          const liveAsstTurn: MessageTurn = {
            id: `turn-asst-live-${Date.now()}`,
            role: "assistant",
            content: "",
            thought: "",
            thoughtExpanded: true,
            thoughtDuration: 0,
            isStreaming: true,
            cards: [],
            blocks: [],
            timestamp: Date.now(),
          };
          unpacked.push(liveAsstTurn);

          chat.chatTurns.value = unpacked;
          chat.sessionTurnsCache.set(session.id, chat.chatTurns.value);

          // 连入该会话的后台广播流，自动重放 + 实时追加
          // （同 sendPrompt：取 reactive 代理对象，保证事件写入触发视图更新）
          const reactiveTurn =
            chat.chatTurns.value[chat.chatTurns.value.length - 1];
          void chat.connectToSessionStream(session.id, reactiveTurn, false);
        } else {
          chat.sessionRunningMap.set(session.id, false);
          chat.isRunning.value = false;
          if (unpacked.length === 0) {
            unpacked.push({
              id: `turn-seed-${session.id}`,
              role: "assistant",
              content: `已加载会话「${session.title}」。工作区绑定至 \`${options.getWorkspaceRootPath()}\`。随时可以输入任务指令或向 Agent 提问。`,
              timestamp: session.updatedAt,
            });
          }
          chat.chatTurns.value = unpacked;
          chat.sessionTurnsCache.set(session.id, chat.chatTurns.value);
        }
      }
    } catch (e) {
      console.error("加载会话详情失败:", e);
    }

    // 历史加载完成：强制回底
    options.scrollToBottom({ force: true });
  }

  async function toggleArchiveSession(id: string, archived: boolean) {
    try {
      await patchSession(id, {
        archived,
        status: archived ? "archived" : "active",
      });
      const s = sessions.value.find((x) => x.id === id);
      if (s) {
        s.archived = archived;
        s.status = archived ? "archived" : "active";
      }
    } catch (e) {
      console.error("归档操作失败:", e);
    }
  }

  /** 重命名会话（VaSessionTree rename 事件：组件内编辑，提交即落库） */
  async function renameSession(id: string, title: string) {
    const newTitle = title.trim();
    if (!newTitle) return;
    try {
      const updated = await patchSession(id, { title: newTitle });
      if (updated) {
        const target = sessions.value.find((s) => s.id === id);
        if (target) target.title = newTitle;
      }
    } catch (e) {
      console.error("重命名会话失败:", e);
    }
  }

  /** 删除会话：vaConfirm 模态确认（danger tone，初始聚焦取消——安全默认），确认后才发删除请求 */
  async function askDeleteSession(sessionId: string) {
    const target = sessions.value.find((s) => s.id === sessionId);
    const ok = await vaConfirm({
      title: "删除这个会话？",
      description: `「${target?.title || "未命名会话"}」的全部消息与工具调用记录将被清除，此操作不可撤销。`,
      confirmText: "删除",
      tone: "danger",
      icon: true,
    });
    if (ok) await deleteSession(sessionId);
  }

  async function deleteSession(sessionId: string) {
    try {
      await deleteSessionById(sessionId);
      sessions.value = sessions.value.filter((s) => s.id !== sessionId);
      if (activeSessionId.value === sessionId) {
        options.onActiveDeleted();
      }
    } catch (e) {
      console.error("删除会话失败:", e);
    }
  }

  return {
    sessions,
    activeSessionId,
    activeSessions,
    archivedSessions,
    fetchSessions,
    createSessionForPrompt,
    selectSession,
    renameSession,
    toggleArchiveSession,
    askDeleteSession,
    deleteSession,
  };
}

export type SessionsApi = ReturnType<typeof useSessions>;
