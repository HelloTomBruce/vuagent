import { describe, expect, it } from "vitest";
import { reactive, ref } from "vue";
import {
  appendReactiveTurn,
  useSessionRunRegistry,
} from "../composables/hooks/useSessionRunRegistry";
import type { MessageTurn } from "../types";

const getActiveSessionId = () => "sess-active";

const turn = (id: string): MessageTurn =>
  ({ id, role: "assistant", content: "", blocks: [] }) as unknown as MessageTurn;

describe("useSessionRunRegistry（TASK-113）", () => {
  it("markRunning/markStopped：运行态与控制器登记/清理", () => {
    const registry = useSessionRunRegistry(getActiveSessionId);
    const ctrl = new AbortController();
    registry.markRunning("sess-1", ctrl);
    expect(registry.sessionRunningMap.get("sess-1")).toBe(true);
    expect(registry.getAbortController("sess-1")).toBe(ctrl);

    registry.markStopped("sess-1");
    expect(registry.sessionRunningMap.get("sess-1")).toBe(false);
    expect(registry.getAbortController("sess-1")).toBeUndefined();
  });

  it("isActiveSession：空目标视为活跃；异会话不活跃", () => {
    const registry = useSessionRunRegistry(getActiveSessionId);
    expect(registry.isActiveSession(undefined)).toBe(true);
    expect(registry.isActiveSession("sess-active")).toBe(true);
    expect(registry.isActiveSession("sess-other")).toBe(false);
  });

  it("cacheTurns 缓存会话 turns 引用", () => {
    const registry = useSessionRunRegistry(getActiveSessionId);
    const turns = [turn("t1")];
    registry.cacheTurns("sess-1", turns);
    expect(registry.sessionTurnsCache.get("sess-1")).toBe(turns);
  });

  it("sessionRunningMap 为响应式 Map（可驱动视图）", () => {
    const registry = useSessionRunRegistry(getActiveSessionId);
    // reactive 包装：可 set/get，行为同 Map（此处断言其数据面即可）
    registry.sessionRunningMap.set("k", true);
    expect(registry.sessionRunningMap.get("k")).toBe(true);
    void reactive;
  });
});

describe("appendReactiveTurn 代理陷阱防线（TASK-113）", () => {
  it("返回数组内的响应式代理引用（修改经代理写入同一底层数据）", () => {
    const list = ref<MessageTurn[]>([]);
    const raw = turn("t1");
    const proxied = appendReactiveTurn(list, raw);

    // 代理引用 !== 原始对象（Vue ref 深响应包装）
    expect(proxied).not.toBe(raw);
    // 数组内取回的是代理
    expect(list.value[0]).toBe(proxied);
    // 经代理写入反映到原始对象（同一底层数据）
    proxied.content = "streamed";
    expect(raw.content).toBe("streamed");
  });
});
