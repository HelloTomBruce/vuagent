// @vitest-environment happy-dom
/**
 * VaForm + ui_form 注册链路 dom 测试（TASK-092 / 方案 A 重构）：
 * 六型字段渲染（select 组合 VaSelect）/ required 校验 / 类型收敛 /
 * 提交信封（values + editedFields）/ cancel / fieldErrors 回显 / 非 executing 态禁提交。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import VaAgentRenderer from "../src/runtime/VaAgentRenderer.vue";
import { setupDefaultAgentRegistry, getAgentComponent } from "../src/runtime/registry";
import { formFieldErrors } from "../src/runtime/form-errors";

const FORM_ARGS = {
  title: "创建部署",
  description: "补充部署参数",
  submitLabel: "确认创建",
  fields: [
    { key: "env", label: "部署环境", type: "select", required: true, options: [
      { value: "prod", label: "生产（8C16G）" },
      { value: "staging", label: "预发（4C8G）" },
    ] },
    { key: "replicas", label: "副本数", type: "number", unit: "个", default: 2 },
    { key: "tls", label: "开启 TLS", type: "boolean" },
    { key: "note", label: "备注", type: "textarea", placeholder: "可选" },
    { key: "apiKey", label: "访问令牌", type: "text", secret: true, required: true },
    { key: "releaseDate", label: "发布日期", type: "date" },
  ],
};

beforeAll(() => {
  setupDefaultAgentRegistry();
});

const mountForm = (status: "streaming" | "executing" | "done" = "executing") =>
  mount(VaAgentRenderer, {
    props: {
      toolCallId: "call-form-1",
      componentName: "ui_form",
      args: FORM_ARGS,
      status,
    },
  });

/** 打开 VaSelect 弹层并点选指定 label 的选项（combobox 交互协议）
 *  弹层经 VaPopover Teleport 到 body——必须用 document 查询 + 原生事件（同 select.dom.test 约定） */
const pickOption = async (w: ReturnType<typeof mountForm>, label: string) => {
  await w.find(".va-sel__trigger").trigger("click");
  const opt = Array.from(document.querySelectorAll<HTMLElement>(".va-sel__opt")).find(
    (el) => el.textContent?.includes(label)
  );
  expect(opt, `选项「${label}」未在弹层中找到`).toBeTruthy();
  opt!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
};

const buttons = (w: ReturnType<typeof mountForm>) => w.findAll("button");
const buttonByText = (w: ReturnType<typeof mountForm>, text: string) =>
  buttons(w).find((b) => b.text().trim() === text);

describe("ui_form 渲染", () => {
  it("六型字段全部渲染：VaSelect 触发器、number、boolean 开关、textarea、secret 密码态、date", () => {
    const w = mountForm();
    expect(w.find(".va-form__title").text()).toBe("创建部署");
    expect(w.findAll(".va-form__field").length).toBe(6);
    expect(w.find(".va-sel__trigger").exists()).toBe(true); // VaSelect 组合（方案 A）
    expect(w.find(".va-sel__trigger").text()).toContain("请选择");
    expect(w.find('input[type="number"]').exists()).toBe(true);
    expect(w.find('input[type="checkbox"]').exists()).toBe(true);
    expect(w.find("textarea").exists()).toBe(true);
    expect(w.find('input[type="password"]').exists()).toBe(true);
    expect(w.find('input[type="date"]').exists()).toBe(true);
  });

  it("默认值回显：number 字段预填 default=2", () => {
    const w = mountForm();
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe("2");
  });

  it("必填星标与敏感徽章", () => {
    const w = mountForm();
    expect(w.findAll(".va-form__req").length).toBe(2); // env + apiKey
    expect(w.find(".va-form__badge").exists()).toBe(true);
  });

  it("secret 字段显示/隐藏切换（VaButton ghost）", async () => {
    const w = mountForm();
    expect(w.find('input[type="password"]').exists()).toBe(true);
    const toggle = buttonByText(w, "显示");
    expect(toggle).toBeTruthy();
    await toggle!.trigger("click");
    expect(w.find('input[type="text"]').exists()).toBe(true);
  });

  it("提交/取消为 VaButton 组件（variant primary/secondary）", () => {
    const w = mountForm();
    expect(buttonByText(w, "确认创建")).toBeTruthy();
    expect(buttonByText(w, "取消")).toBeTruthy();
  });
});

describe("ui_form 提交链路", () => {
  it("executing 态：填写后提交，onSubmitAction 收到 submit 信封（values 类型收敛 + meta.editedFields）", async () => {
    const w = mountForm("executing");
    const actions: unknown[] = [];
    await w.setProps({ onSubmitAction: async (p: unknown) => { actions.push(p); } });

    await pickOption(w, "生产（8C16G）");
    await w.find('input[type="number"]').setValue("3");
    await w.find('input[type="checkbox"]').setValue(true);
    await w.find('input[type="password"]').setValue("sk-test-123");

    await buttonByText(w, "确认创建")!.trigger("click");

    expect(actions.length).toBe(1);
    const envelope = actions[0] as { kind: string; values: Record<string, unknown>; meta?: { editedFields?: string[] } };
    expect(envelope.kind).toBe("submit");
    expect(envelope.values.env).toBe("prod");
    expect(envelope.values.replicas).toBe(3); // 字符串 → number 收敛
    expect(envelope.values.tls).toBe(true);
    expect(envelope.values.note).toBe("");
    expect(envelope.values.apiKey).toBe("sk-test-123");
    // editedFields：用户改过的字段（replicas 有 default 但被手动改 → 也算 edited）
    expect(envelope.meta?.editedFields).toEqual(expect.arrayContaining(["env", "replicas", "tls", "apiKey"]));
  });

  it("必填缺失：本地拦截不发请求，逐字段错误回显", async () => {
    const w = mountForm("executing");
    const actions: unknown[] = [];
    await w.setProps({ onSubmitAction: async (p: unknown) => { actions.push(p); } });

    await buttonByText(w, "确认创建")!.trigger("click");

    expect(actions.length).toBe(0);
    const errors = w.findAll(".va-form__error").map((e) => e.text());
    expect(errors.length).toBe(2); // env + apiKey
  });

  it("select 错误态透传 VaSelect invalid（服务端 fieldErrors 对 select 字段）", async () => {
    formFieldErrors.set("call-form-1", { env: "请选择部署环境" });
    const w = mountForm("executing");
    expect(w.findAll(".va-form__error").map((e) => e.text())).toContain("请选择部署环境");
    formFieldErrors.delete("call-form-1");
  });

  it("cancel 信封", async () => {
    const w = mountForm("executing");
    const actions: unknown[] = [];
    await w.setProps({ onSubmitAction: async (p: unknown) => { actions.push(p); } });

    await buttonByText(w, "取消")!.trigger("click");
    expect((actions[0] as { kind: string }).kind).toBe("cancel");
  });

  it("非 executing 态（done）：提交被渲染层守卫拦截（disabled 视觉位 + no-op 桩）", async () => {
    const w = mountForm("done");
    expect(w.find(".va-form--disabled").exists()).toBe(true);
    const actions: unknown[] = [];
    await w.setProps({ onSubmitAction: async (p: unknown) => { actions.push(p); } });
    await buttonByText(w, "确认创建")!.trigger("click");
    expect(actions.length).toBe(0);
  });
});

describe("ui_form fieldErrors 通道（§4.2 重填闭环）", () => {
  it("formFieldErrors 写入 → 表单就地回显 server 错误；用户修改该字段后错误隐藏", async () => {
    formFieldErrors.set("call-form-1", { replicas: "当前环境最大支持 2 个" });
    const w = mountForm("executing");

    expect(w.findAll(".va-form__error").map((e) => e.text())).toContain("当前环境最大支持 2 个");

    // 用户修改该字段 → server 错误视为过期，就地隐藏
    await w.find('input[type="number"]').setValue("2");
    expect(w.findAll(".va-form__error").map((e) => e.text())).not.toContain("当前环境最大支持 2 个");

    formFieldErrors.delete("call-form-1");
  });

  // 评审 C-2 回归：422 回填触发 computed 重算 → fields 新数组引用——
  // 修复前 watch 按引用比较触发 reset()，把用户已填值全部清空
  it("422 回填错误时保留用户已填值（fields 引用变化不得 reset）", async () => {
    const w = mountForm("executing");
    await w.find('input[type="number"]').setValue("5");
    await w.find('input[type="password"]').setValue("sk-typing-halfway");

    formFieldErrors.set("call-form-1", { env: "部署环境不可用，请重选" });
    await new Promise((r) => setTimeout(r, 50)); // 让 computed 重算 + watch 判定

    // 已填值保留（修复前：fields 引用变化 → reset 清空）
    expect((w.find('input[type="number"]').element as HTMLInputElement).value).toBe("5");
    expect((w.find('input[type="password"]').element as HTMLInputElement).value).toBe("sk-typing-halfway");
    // 未触碰字段的 server 错误照常回显（replicas 被用户改过 → 其错误按规则隐藏）
    expect(w.findAll(".va-form__error").map((e) => e.text())).toContain("部署环境不可用，请重选");

    formFieldErrors.delete("call-form-1");
  });
});

describe("ui_form 注册契约", () => {
  it("interaction 声明 L2 + deriveResultSchema 可按 args 派生（required/select/secret 映射）", () => {
    const entry = getAgentComponent("ui_form");
    expect(entry?.interaction?.level).toBe("L2");
    const schema = entry?.interaction?.deriveResultSchema?.(FORM_ARGS) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect((schema.required as string[]).sort()).toEqual(["apiKey", "env"]);
    const replicas = (schema.properties as Record<string, Record<string, unknown>>).replicas;
    expect(replicas.type).toBe("number");
    expect(replicas.unit).toBe("个");
    const apiKey = (schema.properties as Record<string, Record<string, unknown>>).apiKey;
    expect(apiKey.secret).toBe(true);
    const env = (schema.properties as Record<string, Record<string, unknown>>).env;
    expect(Array.isArray(env.anyOf)).toBe(true);
  });

  it("不可信 fields 守卫：脏字段被丢弃、合法字段保留", () => {
    const entry = getAgentComponent("ui_form");
    const schema = entry?.interaction?.deriveResultSchema?.({
      fields: [
        { key: "ok", label: "正常", type: "text" },
        { key: 123, label: "坏key" },
        { label: "缺type" },
        { key: "badtype", label: "坏type", type: "hacker" },
        null,
        "str",
      ],
    }) as Record<string, unknown>;
    expect(Object.keys(schema.properties as object)).toEqual(["ok"]);
  });
});
