import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  VuagentSystemToolSchemas,
  AllToolSchemas,
  type VuagentAllToolName,
} from "../src/index.js";

describe("系统工具入参 Schema（TASK-055 契约收口）", () => {
  it("注册表覆盖 8 个系统工具（含 finish_task 显式终态声明）", () => {
    expect(Object.keys(VuagentSystemToolSchemas).sort()).toEqual(
      ["bash_run", "finish_task", "fs_edit", "fs_read", "fs_write", "glob", "grep", "web_fetch"].sort()
    );
  });

  it("AllToolSchemas = ui 全集 ∪ 系统全集", () => {
    expect(Object.keys(AllToolSchemas)).toHaveLength(14);
  });

  it.each([
    ["fs_read", { filePath: "a.ts" }],
    ["fs_read", { filePath: "a.ts", offset: 2, limit: 10 }],
    ["fs_write", { filePath: "a.ts", content: "x" }],
    ["fs_edit", { filePath: "a.ts", oldString: "a", newString: "b" }],
    ["bash_run", { command: "ls" }],
    ["bash_run", { command: "ls", timeoutMs: 5000 }],
    ["glob", { pattern: "src/**/*.ts" }],
    ["grep", { pattern: "\\w+" }],
    ["grep", { pattern: "x", flags: "i", include: "*.ts" }],
    ["web_fetch", { url: "https://example.com" }],
    ["finish_task", { summary: "完成了代码重构" }],
    ["finish_task", { summary: "完成", deliverables: [{ kind: "diff", ref: "card-1" }] }],
  ] as const)("合法入参: %s %o 通过", (name, args) => {
    expect(Value.Check(VuagentSystemToolSchemas[name], args)).toBe(true);
  });

  it.each([
    ["fs_read", {}], // filePath 缺失
    ["fs_read", { filePath: "a.ts", offset: "2" }], // offset 类型错
    ["fs_write", { filePath: "a.ts" }], // content 缺失
    ["fs_edit", { filePath: "a.ts", oldString: "a" }], // newString 缺失
    ["bash_run", {}], // command 缺失
    ["bash_run", { command: "ls", timeoutMs: "5s" }], // timeoutMs 类型错
    ["glob", {}], // pattern 缺失
    ["grep", { pattern: 42 }], // pattern 类型错
    ["web_fetch", {}], // url 缺失
    ["finish_task", {}], // summary 缺失
    ["finish_task", { summary: "x", deliverables: "not-array" }], // deliverables 类型错
  ] as const)("非法入参: %s %o 被拒绝", (name, args) => {
    expect(Value.Check(VuagentSystemToolSchemas[name], args)).toBe(false);
  });

  it("VuagentAllToolName 联合类型同时容纳 ui 与系统工具名（编译期）", () => {
    const names: VuagentAllToolName[] = ["ui_code_diff", "fs_read", "bash_run"];
    expect(names.length).toBe(3);
  });
});
