/**
 * TASK-092（实施方案 TASK-E）：ui_form 契约测试。
 * 覆盖：FormToolSchema/FormFieldSchema 形状（六型/minItems/Function Calling 扁平约束）、
 * deriveFormResultSchema 派生器（六型映射/required/枚举 label/secret/unit/default）、
 * 派生 Schema 直接被 TypeBox Value.Check 消费（server 边界校验同口径）、
 * coerceFormFields 不可信输入收敛。
 */
import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  FormToolSchema,
  FormFieldSchema,
  deriveFormResultSchema,
  liftFormResultSchema,
  coerceFormFields,
  assertValidInteraction,
  UIComponentInteractionError,
  type FormField,
} from "../src/index.js";

const DEPLOY_FIELDS: FormField[] = [
  {
    key: "env",
    label: "部署环境",
    type: "select",
    required: true,
    description: "目标部署环境",
    options: [
      { value: "staging", label: "预发环境" },
      { value: "prod", label: "生产环境" },
    ],
  },
  {
    key: "replicas",
    label: "副本数",
    type: "number",
    required: true,
    unit: "个",
    default: 1,
  },
  { key: "enableTls", label: "开启 TLS", type: "boolean", default: true },
  { key: "note", label: "备注", type: "textarea" },
  { key: "deployAt", label: "部署日期", type: "date" },
  {
    key: "apiKey",
    label: "访问密钥",
    type: "text",
    required: true,
    secret: true,
    placeholder: "sk-...",
  },
];

describe("FormToolSchema / FormFieldSchema（§7 契约形状）", () => {
  it("合法工具入参通过校验（$id = ui_form）", () => {
    expect(FormToolSchema.$id).toBe("ui_form");
    const args = { title: "创建部署", fields: DEPLOY_FIELDS, submitLabel: "确认创建" };
    expect(Value.Check(FormToolSchema, args)).toBe(true);
  });

  it("fields 至少一个字段（minItems: 1）", () => {
    expect(Value.Check(FormToolSchema, { title: "x", fields: [] })).toBe(false);
  });

  it("六型之外的字段类型被拒绝", () => {
    for (const type of ["text", "textarea", "number", "boolean", "select", "date"]) {
      expect(Value.Check(FormFieldSchema, { key: "k", label: "l", type })).toBe(true);
    }
    expect(Value.Check(FormFieldSchema, { key: "k", label: "l", type: "email" })).toBe(false);
    expect(Value.Check(FormFieldSchema, { key: "k", label: "l", type: "password" })).toBe(false);
  });

  it("保持扁平结构（无 $ref/递归——Function Calling 校验器兼容约束）", () => {
    const json = JSON.stringify(FormToolSchema);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$defs");
  });
});

describe("deriveFormResultSchema（resultSchema 派生器）", () => {
  const schema = deriveFormResultSchema(DEPLOY_FIELDS) as unknown as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it("六型映射：select/text/textarea/date→string，number→number，boolean→boolean", () => {
    expect(schema.type).toBe("object");
    expect(schema.properties.env.type).toBe("string");
    expect(schema.properties.replicas.type).toBe("number");
    expect(schema.properties.enableTls.type).toBe("boolean");
    expect(schema.properties.note.type).toBe("string");
    expect(schema.properties.deployAt.type).toBe("string");
    expect(schema.properties.apiKey.type).toBe("string");
  });

  it("required:true 字段进入顶层 required 数组（保持声明顺序）", () => {
    expect(schema.required).toEqual(["env", "replicas", "apiKey"]);
  });

  it("select 派生 anyOf 枚举（const + label/description 同体，供摘要 label 回映）", () => {
    expect(schema.properties.env.anyOf).toEqual([
      { const: "staging", label: "预发环境", description: "预发环境" },
      { const: "prod", label: "生产环境", description: "生产环境" },
    ]);
  });

  it("secret/unit/default/description 作为自定义关键字透传", () => {
    expect(schema.properties.apiKey.secret).toBe(true);
    expect(schema.properties.replicas.unit).toBe("个");
    expect(schema.properties.replicas.default).toBe(1);
    expect(schema.properties.env.description).toBe("目标部署环境");
    // description 缺省回退 label（摘要词汇表兜底）
    expect(schema.properties.replicas.description).toBe("副本数");
  });

  it("liftFormResultSchema：提升后被 TypeBox Value.Check 消费（server 边界校验同口径）", () => {
    const derived = liftFormResultSchema(deriveFormResultSchema(DEPLOY_FIELDS));
    // 合法值通过
    expect(
      Value.Check(derived, {
        env: "prod",
        replicas: 3,
        enableTls: false,
        apiKey: "sk-live-123456",
      })
    ).toBe(true);
    // 缺必填 → 拒绝
    expect(Value.Check(derived, { env: "prod", apiKey: "sk-1" })).toBe(false);
    // 类型错误 → 拒绝
    expect(
      Value.Check(derived, { env: "prod", replicas: "three", apiKey: "sk-1" })
    ).toBe(false);
    // 枚举外取值 → 拒绝
    expect(
      Value.Check(derived, { env: "mars", replicas: 1, apiKey: "sk-1" })
    ).toBe(false);
    // 可选字段缺省 → 通过
    expect(Value.Check(derived, { env: "staging", replicas: 1, apiKey: "x" })).toBe(true);
  });

  it("liftFormResultSchema：自定义关键字透传（摘要词汇表/打码数据源不丢）", () => {
    const lifted = liftFormResultSchema(deriveFormResultSchema(DEPLOY_FIELDS)) as any;
    expect(lifted.properties.apiKey.secret).toBe(true);
    expect(lifted.properties.apiKey.description).toBe("访问密钥");
    expect(lifted.properties.replicas.unit).toBe("个");
    expect(lifted.properties.replicas.default).toBe(1);
    expect(lifted.properties.env.anyOf).toMatchObject([
      { const: "staging", type: "string", label: "预发环境", description: "预发环境" },
      { const: "prod", type: "string", label: "生产环境", description: "生产环境" },
    ]);
  });

  it("空 options 的 select 退化为普通 string（不产出空 anyOf）", () => {
    const s = deriveFormResultSchema([
      { key: "env", label: "环境", type: "select", options: [] },
    ]) as unknown as { properties: Record<string, any> };
    expect(s.properties.env).toMatchObject({ type: "string" });
    expect(s.properties.env.anyOf).toBeUndefined();
  });

  it("无 required 字段时不产出空 required 数组", () => {
    const s = deriveFormResultSchema([{ key: "note", label: "备注", type: "text" }]) as unknown as Record<
      string,
      unknown
    >;
    expect(s.required).toBeUndefined();
  });
});

describe("coerceFormFields（不可信输入收敛）", () => {
  it("非数组/非对象条目/缺 key/缺 label/非法 type 一律丢弃", () => {
    const fields = coerceFormFields([
      null,
      "x",
      { label: "l", type: "text" },
      { key: "k", type: "text" },
      { key: "k", label: "l", type: "email" },
      { key: "ok", label: "合法", type: "number", required: true, unit: "个" },
    ]);
    expect(fields).toEqual([{ key: "ok", label: "合法", type: "number", required: true, unit: "个" }]);
  });

  it("options 过滤非法项；非数组输入返回空列表", () => {
    expect(coerceFormFields(undefined)).toEqual([]);
    expect(coerceFormFields({})).toEqual([]);
    const [f] = coerceFormFields([
      { key: "env", label: "环境", type: "select", options: [{ value: "a" }, { value: "b", label: "B" }, 1] },
    ]);
    expect(f.options).toEqual([{ value: "b", label: "B" }]);
  });
});

describe("interaction 声明：deriveResultSchema 与 resultSchema 二选一（TASK-092）", () => {
  it("L2 仅声明 deriveResultSchema 合法", () => {
    expect(() =>
      assertValidInteraction("ui_form", {
        level: "L2",
        deriveResultSchema: () => deriveFormResultSchema(DEPLOY_FIELDS),
      })
    ).not.toThrow();
  });

  it("L2 两者皆缺仍在定义期报错", () => {
    expect(() => assertValidInteraction("bad_form", { level: "L2" })).toThrow(
      UIComponentInteractionError
    );
  });
});
