import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  ApprovalCardToolSchema,
  TrajectoryToolSchema,
  CodeDiffToolSchema,
  MetricChartToolSchema,
  AgentPlanToolSchema,
  FileTreeToolSchema,
  ApprovalActionPayloadSchema,
  isTextDeltaEvent,
  isComponentEvent,
  isUsageEvent,
  type UIStreamEvent,
  type HarnessStreamEvent,
} from "../src/index.js";

describe("@vuagent/protocol - TypeBox Schemas", () => {
  it("validates ApprovalCardToolSchema correctly", () => {
    const validData = {
      title: "部署审批",
      risk: "high",
      countdown: 30,
      preview: "kubectl apply -f prod.yaml",
    };
    expect(Value.Check(ApprovalCardToolSchema, validData)).toBe(true);

    const invalidData = {
      risk: "invalid_level",
    };
    expect(Value.Check(ApprovalCardToolSchema, invalidData)).toBe(false);
  });

  it("validates ApprovalActionPayloadSchema", () => {
    const validPayload = {
      approved: true,
      reason: "manual",
      note: "确认无误",
    };
    expect(Value.Check(ApprovalActionPayloadSchema, validPayload)).toBe(true);
  });

  it("validates TrajectoryToolSchema correctly", () => {
    const validTrajectory = {
      events: [
        {
          id: "evt-1",
          at: Date.now(),
          lane: "tool",
          role: "tool",
          title: "exec_cmd",
          detail: '{"cmd":"ls"}',
          turn: 1,
        },
      ],
      ledgerMaxHeight: 400,
    };
    expect(Value.Check(TrajectoryToolSchema, validTrajectory)).toBe(true);
  });

  it("validates CodeDiffToolSchema correctly", () => {
    const validDiff = {
      oldText: "const a = 1;",
      newText: "const a = 2;",
      fileName: "index.ts",
      layout: "unified",
    };
    expect(Value.Check(CodeDiffToolSchema, validDiff)).toBe(true);
  });

  it("validates MetricChartToolSchema correctly", () => {
    const validChart = {
      title: "响应延迟趋势",
      chartType: "line",
      unit: "ms",
      series: [
        { label: "10:00", value: 120 },
        { label: "10:05", value: 95 },
      ],
    };
    expect(Value.Check(MetricChartToolSchema, validChart)).toBe(true);
  });

  it("validates AgentPlanToolSchema correctly", () => {
    const validPlan = {
      title: "代码审查执行计划",
      steps: [
        { id: "s1", title: "静态检查", status: "done", duration: 1500 },
        { id: "s2", title: "单元测试覆盖率比对", status: "running", startedAt: Date.now() },
        { id: "s3", title: "合规安全扫描", status: "pending" },
      ],
      editable: false,
    };
    expect(Value.Check(AgentPlanToolSchema, validPlan)).toBe(true);
  });

  it("validates FileTreeToolSchema correctly", () => {
    const validTree = {
      title: "项目源码目录",
      defaultExpandDepth: 2,
      tree: [
        {
          path: "src",
          type: "dir",
          children: [
            {
              path: "src/utils",
              type: "dir",
              children: [
                { path: "src/utils/format.ts", type: "file", status: "added" },
              ],
            },
            { path: "src/index.ts", type: "file", status: "modified" },
            { path: "src/utils.ts", type: "file" },
          ],
        },
        { path: "package.json", type: "file", status: "added" },
      ],
    };
    expect(Value.Check(FileTreeToolSchema, validTree)).toBe(true);

    // 验证导出的 JSON Schema 中不包含未被 #/$defs/ 解析的原生 $ref（确保 Moonshot/Kimi 等模型兼容）
    const schemaJson = JSON.stringify(FileTreeToolSchema);
    expect(schemaJson).not.toContain('"$ref":"This"');
    expect(schemaJson).not.toContain('"$ref"');
  });
});

describe("@vuagent/protocol - Event Type Guards", () => {
  it("correctly identifies text_delta events", () => {
    const event: UIStreamEvent = {
      type: "text_delta",
      messageId: "msg-1",
      delta: "你好，正在为您分析...",
    };
    expect(isTextDeltaEvent(event)).toBe(true);
    expect(isComponentEvent(event)).toBe(false);
  });

  it("correctly identifies component events", () => {
    const event: UIStreamEvent = {
      type: "component_start",
      messageId: "msg-1",
      toolCallId: "call-123",
      componentName: "ui_approval_card",
    };
    expect(isTextDeltaEvent(event)).toBe(false);
    expect(isComponentEvent(event)).toBe(true);
  });
});

describe("@vuagent/protocol - usage 事件分段 (parts)", () => {
  it("usage 事件可携带 system/history/tools 三段分段", () => {
    const event: HarnessStreamEvent = {
      type: "usage",
      promptTokens: 320,
      completionTokens: 80,
      totalTokens: 400,
      contextWindow: 128000,
      parts: [
        { id: "system", label: "系统提示", tokens: 96, kind: "system" },
        { id: "history", label: "对话历史", tokens: 224, kind: "history" },
        { id: "tools", label: "工具结果", tokens: 80, kind: "tools" },
      ],
    };
    expect(isUsageEvent(event)).toBe(true);
    expect(event.parts?.map((p) => p.kind)).toEqual(["system", "history", "tools"]);
    expect(event.parts?.reduce((t, p) => t + p.tokens, 0)).toBe(400);
  });

  it("parts 为可选字段(旧服务端无分段时兼容)", () => {
    const event: HarnessStreamEvent = {
      type: "usage",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    };
    expect(isUsageEvent(event)).toBe(true);
    expect(event.parts).toBeUndefined();
  });
});
