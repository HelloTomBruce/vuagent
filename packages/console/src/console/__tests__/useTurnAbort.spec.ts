import { beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock 会被提升到文件顶部——被提升工厂引用的变量必须经 vi.hoisted 创建
const { serverCalls } = vi.hoisted(() => ({ serverCalls: [] as string[] }));

// 路径说明：spec 位于 src/console/__tests__/，"../api/client" 与
// hooks 内 "../../api/client" 解析到同一模块（vi.mock 按解析后模块键生效）
vi.mock("../api/client", () => ({
  abortSession: vi.fn(async () => {
    serverCalls.push("server-abort");
  }),
}));

import { useTurnAbort } from "../composables/hooks/useTurnAbort";
import { useSessionRunRegistry } from "../composables/hooks/useSessionRunRegistry";

beforeEach(() => {
  serverCalls.length = 0; // 文件级 mock 的调用记录按用例隔离
});

describe("useTurnAbort 顺序编排（TASK-113，R1 修复知识固化）", () => {
  it("先通知服务端中止 → 标记停止 → 本地兜底断开 → onStopped 镜像回写", async () => {
    const eventOrder: string[] = [];
    const getActiveSessionId = () => "sess-active";
    const registry = useSessionRunRegistry(getActiveSessionId);
    const localController = new AbortController();
    registry.markRunning("sess-active", localController);
    const abortSpy = vi.spyOn(localController, "abort");
    localController.signal.addEventListener("abort", () => eventOrder.push("local-abort"));

    const { stopExecution } = useTurnAbort({
      getActiveSessionId,
      registry,
      onStopped: () => eventOrder.push("onStopped"),
    });
    await stopExecution();

    // R1 顺序：服务端通知先落账（aborted 事件经流送达的保证）
    expect(serverCalls[0]).toBe("server-abort");
    expect(serverCalls.length).toBe(1);
    // 本地兜底断开仍发生（控制器引用取回先于 markStopped 的删除）
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(registry.sessionRunningMap.get("sess-active")).toBe(false);
    expect(registry.getAbortController("sess-active")).toBeUndefined();
    expect(eventOrder).toContain("onStopped");
  });

  it("无激活会话：跳过服务端通知，仅镜像回写", async () => {
    let stopped = false;
    const registry = useSessionRunRegistry(() => "");
    const { stopExecution } = useTurnAbort({
      getActiveSessionId: () => "",
      registry,
      onStopped: () => {
        stopped = true;
      },
    });
    await stopExecution();
    expect(stopped).toBe(true);
    expect(serverCalls).toHaveLength(0); // 服务端通知不应被调用
  });
});
