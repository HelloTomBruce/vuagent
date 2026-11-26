import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { Type } from "@sinclair/typebox";
import {
  ActionMetaSchema,
  UIActionEnvelopeSchema,
  UIActionParseError,
  UIComponentInteractionError,
  assertValidInteraction,
  interactionLevelOf,
  parseUIActionPayload,
  type UIActionEnvelope,
  type UIComponentInteraction,
} from "../src/index.js";

describe("@vuagent/protocol - UI 交互契约（TASK-088）", () => {
  describe("UIActionEnvelopeSchema 三 kind 判别", () => {
    it("submit：携带 values 与 meta 的完整信封通过", () => {
      const envelope = {
        kind: "submit",
        values: { env: "prod", replicas: 3, tls: true },
        meta: { editedFields: ["replicas"], durationMs: 4200, clientValidated: true },
      };
      expect(Value.Check(UIActionEnvelopeSchema, envelope)).toBe(true);
    });

    it("submit：meta 可缺省，values 必填", () => {
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "submit", values: { a: 1 } })).toBe(true);
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "submit" })).toBe(false);
    });

    it("cancel：reason 可选；契约不定义 values 键（消费方不得读取）", () => {
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "cancel" })).toBe(true);
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "cancel", reason: "先不填了" })).toBe(true);
      // 与全仓 TypeBox 约定一致：默认非严格（不设 additionalProperties:false，
      // 新增字段前向兼容）——cancel 携带多余 values 在 Schema 层被容忍，
      // 「cancel 语义不读取 values」由消费方（server 摘要层）保证，不在形状层强制
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "cancel", values: { a: 1 } })).toBe(true);
    });

    it("patch：L3 预留增量形态，values 必填", () => {
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "patch", values: { step2: { title: "改名" } } })).toBe(true);
      expect(Value.Check(UIActionEnvelopeSchema, { kind: "patch" })).toBe(false);
    });

    it("meta 字段类型错误被拒绝", () => {
      const bad = {
        kind: "submit",
        values: {},
        meta: { editedFields: "not-an-array" },
      };
      expect(Value.Check(UIActionEnvelopeSchema, bad)).toBe(false);
      expect(Value.Check(ActionMetaSchema, { editedFields: "not-an-array" })).toBe(false);
    });
  });

  describe("parseUIActionPayload - 信封直通", () => {
    it("合法 submit 信封原样返回", () => {
      const raw = { kind: "submit", values: { approved: true }, meta: { editedFields: [] } };
      const parsed = parseUIActionPayload(raw);
      expect(parsed).toEqual(raw);
      expect(parsed.kind).toBe("submit");
    });

    it("合法 cancel / patch 信封原样返回", () => {
      expect(parseUIActionPayload({ kind: "cancel", reason: "放弃" }).kind).toBe("cancel");
      expect(parseUIActionPayload({ kind: "patch", values: { x: 1 } }).kind).toBe("patch");
    });

    it("kind 合法但形状残缺（submit 缺 values）抛 UIActionParseError", () => {
      expect(() => parseUIActionPayload({ kind: "submit" })).toThrow(UIActionParseError);
    });

    it("非对象回传体抛 UIActionParseError", () => {
      expect(() => parseUIActionPayload(null)).toThrow(UIActionParseError);
      expect(() => parseUIActionPayload("approved")).toThrow(UIActionParseError);
      expect(() => parseUIActionPayload([{ kind: "submit", values: {} }])).toThrow(UIActionParseError);
    });

    it("无法识别的 kind 抛 UIActionParseError（不允许伪造 timeout 等语义）", () => {
      expect(() => parseUIActionPayload({ kind: "timeout", values: {} })).toThrow(UIActionParseError);
    });
  });

  describe("parseUIActionPayload - 旧审批形态兼容映射", () => {
    it("完整旧形态 {approved, reason, note} 映射为 submit 信封并保留三键", () => {
      const parsed = parseUIActionPayload({ approved: true, reason: "manual", note: "确认无误" });
      expect(parsed.kind).toBe("submit");
      expect((parsed as Extract<UIActionEnvelope, { kind: "submit" }>).values).toEqual({
        approved: true,
        reason: "manual",
        note: "确认无误",
      });
    });

    it("裸 {approved: false} 同样映射（最小旧形态）", () => {
      const parsed = parseUIActionPayload({ approved: false });
      expect(parsed.kind).toBe("submit");
      expect((parsed as Extract<UIActionEnvelope, { kind: "submit" }>).values).toEqual({
        approved: false,
      });
    });

    it("approved 非 boolean 的旧形态不认（避免把脏数据当决策）", () => {
      expect(() => parseUIActionPayload({ approved: "yes" })).toThrow(UIActionParseError);
    });

    it("旧形态映射结果是合法信封（可通过 Schema 复核）", () => {
      const parsed = parseUIActionPayload({ approved: true, note: "ok" });
      expect(Value.Check(UIActionEnvelopeSchema, parsed)).toBe(true);
    });
  });

  describe("interaction 声明的定义期校验", () => {
    it("未声明 interaction 时缺省等级为 L0（纯展示）", () => {
      expect(interactionLevelOf(undefined)).toBe("L0");
      expect(interactionLevelOf({ level: "L1" })).toBe("L1");
    });

    it("L2 缺 resultSchema 抛 UIComponentInteractionError（定义期拦截）", () => {
      expect(() => assertValidInteraction("ui_form", { level: "L2" })).toThrow(
        UIComponentInteractionError
      );
    });

    it("L3 缺 resultSchema 同样抛错", () => {
      expect(() => assertValidInteraction("ui_board", { level: "L3" })).toThrow(
        UIComponentInteractionError
      );
    });

    it("L2/L3 提供 resultSchema 后通过；L0/L1 不强制", () => {
      const resultSchema = Type.Object({ env: Type.String() });
      expect(() =>
        assertValidInteraction("ui_form", { level: "L2", resultSchema })
      ).not.toThrow();
      expect(() => assertValidInteraction("ui_chart", { level: "L0" })).not.toThrow();
      expect(() => assertValidInteraction("ui_approval_card", { level: "L1" })).not.toThrow();
    });

    it("timeoutMeaning 只允许 cancel/deny（超时不得映射为提交语义）", () => {
      const bad = {
        level: "L2",
        resultSchema: Type.Object({}),
        timeoutMeaning: "submit",
      } as unknown as UIComponentInteraction;
      expect(() => assertValidInteraction("ui_form", bad)).toThrow(UIComponentInteractionError);
      expect(() =>
        assertValidInteraction("ui_form", {
          level: "L2",
          resultSchema: Type.Object({}),
          timeoutMeaning: "cancel",
        })
      ).not.toThrow();
    });

    it("parseUIActionPayload 携带非法 interaction 时在解析前即抛出", () => {
      expect(() =>
        parseUIActionPayload({ kind: "cancel" }, { level: "L2" })
      ).toThrow(UIComponentInteractionError);
    });
  });
});
