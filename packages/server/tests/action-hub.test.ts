import { describe, it, expect, vi } from "vitest";
import { ActionHub } from "../src/core/action-hub.js";

describe("ActionHub (HITL Interruption & Resume)", () => {
  it("should suspend and resolve when external action submitted", async () => {
    const hub = new ActionHub();
    const actionId = "call-123";

    const promise = hub.waitForAction(actionId, {
      toolName: "ui_approval_card",
      args: { title: "Deploy to Prod" },
      timeoutMs: 5000,
    });

    const suspended = hub.getSuspended(actionId);
    expect(suspended).toBeDefined();
    expect(suspended?.toolName).toBe("ui_approval_card");

    const resolved = hub.resolveAction(actionId, {
      approved: true,
      note: "LGTM",
    });
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.note).toBe("LGTM");
    expect(hub.getSuspended(actionId)).toBeUndefined();
  });

  it("should auto-resolve with timeout when no decision made", async () => {
    vi.useFakeTimers();
    const hub = new ActionHub();
    const actionId = "call-timeout";

    const promise = hub.waitForAction(actionId, {
      toolName: "bash_run",
      args: { command: "rm -rf /" },
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(1050);

    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("timeout");

    vi.useRealTimers();
  });

  it("should abort suspended action with custom reason", async () => {
    const hub = new ActionHub();
    const actionId = "call-abort";

    const promise = hub.waitForAction(actionId, {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });

    const aborted = hub.abortAction(actionId, "User cancelled conversation");
    expect(aborted).toBe(true);

    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("aborted");
    expect(result.note).toBe("User cancelled conversation");
  });
});
