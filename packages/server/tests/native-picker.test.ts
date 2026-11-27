/**
 * 原生文件夹选择器的结果归类（0.7.2 修复回归）：
 * 用户点「取消」时 osascript 以 `用户已取消。 (-128)` 非零退出——0.7.1 及更早把它当
 * 失败回 500，前端于是降级成「手动输入路径」，用户看到的现象就是「点新建工作区却让
 * 我手打路径」。这里锁住三态区分：选中 / 取消 / 不可用（带可执行 hint）。
 */
import { describe, it, expect } from "vitest";
import {
  classifyFailure,
  classifyStdout,
  pickNativeDirectory,
  pickerCommand,
} from "../src/core/native-picker.js";

describe("classifyStdout", () => {
  it("有路径 → picked（去掉尾部换行）", () => {
    expect(classifyStdout("/Users/me/project\n")).toEqual({ status: "picked", path: "/Users/me/project" });
  });

  it("空输出 → cancelled（Windows 取消时退出码 0 且无输出）", () => {
    expect(classifyStdout("  \n")).toEqual({ status: "cancelled" });
  });
});

describe("classifyFailure：取消 ≠ 失败", () => {
  it("macOS 取消（-128）→ cancelled", () => {
    const outcome = classifyFailure("darwin", {
      code: 1,
      stderr: "15:60: execution error: 用户已取消。 (-128)",
    });
    expect(outcome).toEqual({ status: "cancelled" });
  });

  it("英文环境的取消（User canceled）→ cancelled", () => {
    expect(classifyFailure("darwin", { code: 1, stderr: "execution error: User canceled. (-128)" })).toEqual({
      status: "cancelled",
    });
  });

  it("zenity 取消（退出码 1、stderr 空）→ cancelled", () => {
    expect(classifyFailure("linux", { code: 1, stderr: "" })).toEqual({ status: "cancelled" });
  });

  it("zenity 未安装（ENOENT）→ unavailable + 安装提示", () => {
    const outcome = classifyFailure("linux", { code: "ENOENT", message: "spawn zenity ENOENT" });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") {
      expect(outcome.reason).toMatch(/zenity/);
      expect(outcome.hint).toMatch(/apt install zenity/);
    }
  });

  it("超时 → unavailable + 重试提示", () => {
    const outcome = classifyFailure("darwin", { code: "ETIMEDOUT", message: "Command timed out" });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") expect(outcome.hint).toMatch(/重试/);
  });

  it("真正的错误：取最后一条有意义的行做 reason，并过滤 macOS 键盘布局噪音", () => {
    const outcome = classifyFailure("darwin", {
      code: 1,
      stderr:
        "2026-11-27 17:34:49 osascript Keyboard Layouts: duplicate keyboard layout identifier -17410.\n15:60: execution error: 不允许发送按键。 (-1719)",
    });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status === "unavailable") {
      expect(outcome.reason).toContain("-1719");
      expect(outcome.reason).not.toContain("Keyboard Layouts");
    }
  });
});

describe("pickNativeDirectory（注入执行器）", () => {
  it("选中 → picked", async () => {
    const outcome = await pickNativeDirectory({
      platform: "darwin",
      run: async () => ({ stdout: "/tmp/proj\n", stderr: "" }),
    });
    expect(outcome).toEqual({ status: "picked", path: "/tmp/proj" });
  });

  it("取消不抛错，返回 cancelled", async () => {
    const outcome = await pickNativeDirectory({
      platform: "darwin",
      run: async () => {
        throw Object.assign(new Error("Command failed"), {
          code: 1,
          stderr: "execution error: 用户已取消。 (-128)",
        });
      },
    });
    expect(outcome).toEqual({ status: "cancelled" });
  });

  it("命令不存在 → unavailable（不抛错，交由接口回 503）", async () => {
    const outcome = await pickNativeDirectory({
      platform: "linux",
      run: async () => {
        throw Object.assign(new Error("spawn zenity ENOENT"), { code: "ENOENT" });
      },
    });
    expect(outcome.status).toBe("unavailable");
  });

  it("各平台的命令与参数（execFile 传参，避免 shell 引号问题）", () => {
    expect(pickerCommand("darwin")?.cmd).toBe("osascript");
    expect(pickerCommand("darwin")?.args[1]).toContain("choose folder");
    expect(pickerCommand("win32")?.args).toContain("-NoProfile");
    expect(pickerCommand("linux")?.args).toContain("--directory");
  });
});
