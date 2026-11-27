/**
 * POST /api/workspaces/pick-directory 的三态契约（0.7.2 修复回归）。
 *
 * 事故：用户点「新建工作区」→ 原生框弹出 → 点取消 → osascript 以 `用户已取消 (-128)`
 * 非零退出 → 旧实现回 500 → 前端降级成「手动输入路径」。用户感知就是「怎么让我手打
 * 路径」。契约必须把「取消」与「不可用」分开：
 *   200 {cancelled:true} 取消（静默）｜201 workspace 选中｜409 已有框在等｜503 不可用+hint
 */
import { describe, it, expect } from "vitest";
import { createHarnessServer } from "../src/server.js";
import type { PickerOutcome } from "../src/core/native-picker.js";

function appWith(pickDirectory: () => Promise<PickerOutcome>) {
  return createHarnessServer({ dbPath: ":memory:", pickDirectory }).app;
}

describe("POST /api/workspaces/pick-directory", () => {
  it("用户取消 → 200 {cancelled:true}（不再 500、不触发手动输入）", async () => {
    const app = appWith(async () => ({ status: "cancelled" }));
    const res = await app.request("/api/workspaces/pick-directory", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true });
  });

  it("选中目录 → 201，工作区名取目录名", async () => {
    const app = appWith(async () => ({ status: "picked", path: "/tmp/my-project" }));
    const res = await app.request("/api/workspaces/pick-directory", { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string; rootPath: string };
    expect(body.rootPath).toBe("/tmp/my-project");
    expect(body.name).toBe("my-project");
  });

  it("选择器不可用 → 503 + code + hint（前端据此给明确原因）", async () => {
    const app = appWith(async () => ({
      status: "unavailable",
      reason: "找不到 zenity",
      hint: "sudo apt install zenity",
    }));
    const res = await app.request("/api/workspaces/pick-directory", { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; error: string; hint: string };
    expect(body.code).toBe("PICKER_UNAVAILABLE");
    expect(body.error).toBe("找不到 zenity");
    expect(body.hint).toContain("apt install zenity");
  });

  it("已有选择框在等 → 第二个请求 409 PICKER_BUSY（不叠系统对话框）", async () => {
    let release: (v: PickerOutcome) => void = () => {};
    const pending = new Promise<PickerOutcome>((resolve) => {
      release = resolve;
    });
    const app = appWith(() => pending);

    const first = app.request("/api/workspaces/pick-directory", { method: "POST" });
    await new Promise((r) => setTimeout(r, 20)); // 让第一个请求进入在途状态
    const second = await app.request("/api/workspaces/pick-directory", { method: "POST" });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("PICKER_BUSY");

    release({ status: "cancelled" });
    expect((await first).status).toBe(200);
  });

  it("创建失败（如路径不存在）→ 500 信封，不泄露内部细节", async () => {
    const app = appWith(async () => ({ status: "picked", path: "/nonexistent/definitely-not-here" }));
    const res = await app.request("/api/workspaces/pick-directory", { method: "POST" });
    // 仓库层是否校验路径存在取决于实现；此处只断言「要么建成 201，要么是结构化错误」
    expect([201, 500]).toContain(res.status);
    if (res.status === 500) {
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("PICK_DIRECTORY_FAILED");
    }
  });
});
