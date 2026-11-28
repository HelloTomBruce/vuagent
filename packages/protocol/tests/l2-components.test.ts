/**
 * L2 组件家族派生器测试（0.9.0 W3）：
 * ui_option_picker / ui_wizard（复用 form 派生器）/ ui_data_table。
 * 派生器输出是普通 JSON Schema（server 经 lift* 提升 + ui vendored 副本两侧消费）。
 */
import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  deriveOptionPickerResultSchema,
  liftOptionPickerResultSchema,
  flattenWizardFields,
  deriveDataTableResultSchema,
  liftDataTableResultSchema,
  coerceOptionPickerOptions,
  coerceDataTableColumns,
} from "../src/l2-components.js";
import { deriveFormResultSchema, coerceFormFields, liftFormResultSchema } from "../src/form.js";

describe("deriveOptionPickerResultSchema", () => {
  const options = [
    { id: "a", label: "方案 A" },
    { id: "b", label: "方案 B", description: "更稳" },
  ];

  it("单选：selected 恒长度 1（minItems=maxItems=1）", () => {
    const schema = deriveOptionPickerResultSchema(options, false) as Record<string, any>;
    const selected = schema.properties.selected;
    expect(selected.minItems).toBe(1);
    expect(selected.maxItems).toBe(1);
    expect(selected.items.anyOf).toHaveLength(2);
    expect(selected.items.anyOf[0]).toMatchObject({ const: "a", title: "方案 A" });
    expect(selected.items.anyOf[1].description).toBe("更稳");
  });

  it("多选：无单选长度钳制，上限=选项数", () => {
    const schema = deriveOptionPickerResultSchema(options, true) as Record<string, any>;
    expect(schema.properties.selected.minItems).toBeUndefined();
    expect(schema.properties.selected.maxItems).toBe(2);
  });

  it("lift 后 TypeBox Value.Check 接受合法回传、拒绝非法 id", () => {
    const lifted = liftOptionPickerResultSchema(deriveOptionPickerResultSchema(options, false));
    expect(Value.Check(lifted, { selected: ["a"] })).toBe(true);
    expect(Value.Check(lifted, { selected: ["b"] })).toBe(true);
    expect(Value.Check(lifted, { selected: ["hack"] })).toBe(false); // 非 anyOf 枚举
    expect(Value.Check(lifted, { selected: ["a", "b"] })).toBe(false); // 单选超长
    expect(Value.Check(lifted, { selected: [] })).toBe(false); // 单选空
  });

  it("非法 options（非对象/缺 id/缺 label）被过滤后派生（防御）", () => {
    const schema = deriveOptionPickerResultSchema(
      [{ id: "ok", label: "好" }, { id: "x" }, "junk", null] as never,
      false
    ) as Record<string, any>;
    expect(schema.properties.selected.items.anyOf).toHaveLength(1);
  });
});

describe("ui_wizard（复用 form 派生器）", () => {
  it("flatten 全部步字段 → deriveFormResultSchema；后步同 key 覆盖前步", () => {
    const steps = [
      { title: "S1", fields: [{ key: "host", label: "主机", type: "text", required: true }, { key: "port", label: "端口", type: "number" }] },
      { title: "S2", fields: [{ key: "host", label: "主机(覆盖)", type: "text" }, { key: "token", label: "令牌", type: "text", secret: true }] },
    ];
    const fields = flattenWizardFields(steps as never) as never[];
    expect(fields).toHaveLength(4);
    const schema = deriveFormResultSchema(fields as never) as Record<string, any>;
    expect(schema.properties.host.description).toBe("主机(覆盖)"); // 后步覆盖
    expect(schema.required).toEqual(["host"]); // 覆盖后仍保留 required（S1 声明）
    expect(schema.properties.token.secret).toBe(true);
  });

  it("lift 后 TypeBox Value.Check 走 form 同口径（number/secret 字段）", () => {
    const fields = coerceFormFields([
      { key: "port", label: "端口", type: "number", required: true },
      { key: "name", label: "名称", type: "text" },
    ]);
    const lifted = liftFormResultSchema(deriveFormResultSchema(fields));
    expect(Value.Check(lifted, { port: 8080 })).toBe(true);
    expect(Value.Check(lifted, { port: "8080" })).toBe(false);
    expect(Value.Check(lifted, {})).toBe(false); // port required
  });
});

describe("deriveDataTableResultSchema", () => {
  const columns = [
    { key: "env", label: "环境", type: "select", required: true, options: [{ value: "prod", label: "生产" }, { value: "staging", label: "预发" }] },
    { key: "replicas", label: "副本数", type: "number" },
    { key: "note", label: "备注" },
  ] as never;

  it("values.items 按 columns 组装行对象（select 枚举回映 + required）", () => {
    const schema = deriveDataTableResultSchema(columns) as Record<string, any>;
    const row = schema.properties.values.items;
    expect(row.properties.env.anyOf).toHaveLength(2);
    expect(row.required).toEqual(["env"]);
    expect(row.properties.replicas.type).toBe("number");
    expect(schema.properties.values.maxItems).toBe(50); // 缺省
  });

  it("minRows/maxRows 边界进 schema", () => {
    const schema = deriveDataTableResultSchema(columns, { minRows: 2, maxRows: 10 }) as Record<string, any>;
    expect(schema.properties.values.minItems).toBe(2);
    expect(schema.properties.values.maxItems).toBe(10);
  });

  it("__proto__ 列被防御丢弃", () => {
    const schema = deriveDataTableResultSchema([
      { key: "__proto__", label: "污染", type: "text" },
      { key: "ok", label: "正常", type: "text" },
    ] as never) as Record<string, any>;
    expect(Object.keys(schema.properties.values.items.properties)).toEqual(["ok"]);
  });

  it("lift 后 Value.Check：合法行过、缺 required 列/非法枚举/超行数拒", () => {
    const lifted = liftDataTableResultSchema(deriveDataTableResultSchema(columns, { minRows: 1, maxRows: 2 }));
    expect(Value.Check(lifted, { values: [{ env: "prod", replicas: 3 }] })).toBe(true);
    expect(Value.Check(lifted, { values: [{ replicas: 3 }] })).toBe(false); // env required
    expect(Value.Check(lifted, { values: [{ env: "dev" }] })).toBe(false); // 非 anyOf 枚举
    expect(Value.Check(lifted, { values: [] })).toBe(false); // minRows=1
    expect(Value.Check(lifted, { values: [{ env: "prod" }, { env: "prod" }, { env: "prod" }] })).toBe(false); // 超 maxRows
  });
});

describe("coerce 防御", () => {
  it("coerceOptionPickerOptions 丢弃非法条目并钳 12 上限", () => {
    const junk: any[] = Array.from({ length: 15 }, (_, i) => ({ id: `o${i}`, label: `L${i}` }));
    junk.unshift({ id: "", label: "空 id" }, { id: "__proto__", label: "污染" }, null, { id: "good", label: "好" });
    const out = coerceOptionPickerOptions(junk);
    expect(out[0].id).toBe("good");
    expect(out).toHaveLength(12);
  });

  it("coerceDataTableColumns：未知 type 回落 text", () => {
    const out = coerceDataTableColumns([{ key: "c", label: "C", type: "bogus" }]);
    expect(out[0].type).toBe("text");
  });
});
