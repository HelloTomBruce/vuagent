// @vitest-environment happy-dom
/**
 * ConfigPanel 组件测试（TASK-028）
 * 覆盖验收点：按 schema 渲染控件（boolean→开关 / number→数字输入 / text→多行 / select→下拉）、
 * boolean 开关即时报 patch、number 越界本地钳制并上报钳制值、env 锁定字段只读不响应、
 * reset 按钮仅在有覆盖项时展示并上报 reset。
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ConfigPanel from "../components/settings/ConfigPanel.vue";
import type { ConfigNamespace } from "../api/client";

function fakeNamespace(overrides: Partial<ConfigNamespace> = {}): ConfigNamespace {
  return {
    id: "security",
    title: "安全",
    description: "默认权限模式与网络边界",
    fields: [
      {
        key: "defaultPermissionMode",
        title: "默认权限模式",
        description: "新建会话的缺省权限模式",
        type: "select",
        default: "review",
        options: [
          { value: "review", label: "严格审批 (Review)" },
          { value: "auto", label: "自动执行 (Auto)" },
        ],
      },
      {
        key: "allowPrivateFetch",
        title: "允许抓取私网地址",
        description: "放行 web_fetch 访问内网地址",
        type: "boolean",
        default: false,
        risk: "high",
        envLock: "VUAGENT_ALLOW_PRIVATE_FETCH",
        locked: true,
      },
      {
        key: "maxSteps",
        title: "单轮最大步数",
        description: "步数上限",
        type: "number",
        default: 15,
        min: 1,
        max: 100,
      },
      {
        key: "customInstructions",
        title: "全局自定义指令",
        description: "追加到系统提示末尾",
        type: "text",
        default: "",
        maxLength: 4000,
      },
    ],
    values: {
      defaultPermissionMode: "review",
      allowPrivateFetch: true,
      maxSteps: 15,
      customInstructions: "",
    },
    isDefault: false,
    ...overrides,
  };
}

describe("ConfigPanel（schema 驱动渲染）", () => {
  it("按 field.type 渲染控件：select / switch / number / textarea 齐备", () => {
    const wrapper = mount(ConfigPanel, {
      props: { namespace: fakeNamespace(), loading: false, loadError: "" },
    });
    expect(wrapper.find("[role='combobox']").exists()).toBe(true);
    expect(wrapper.find("button[role='switch']").exists()).toBe(true);
    expect(wrapper.find("input[type='number']").exists()).toBe(true);
    expect(wrapper.find("textarea").exists()).toBe(true);
    // 标题与描述来自 schema
    expect(wrapper.text()).toContain("默认权限模式");
    expect(wrapper.text()).toContain("放行 web_fetch 访问内网地址");
  });

  it("risk 字段展示风险徽标", () => {
    const wrapper = mount(ConfigPanel, {
      props: { namespace: fakeNamespace(), loading: false, loadError: "" },
    });
    const badge = wrapper.find(".va-settings__tool-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("高风险");
    expect(badge.classes()).toContain("va-settings__tool-badge--high");
  });

  it("加载/失败/空态", () => {
    const loading = mount(ConfigPanel, {
      props: { namespace: null, loading: true, loadError: "" },
    });
    expect(loading.text()).toContain("正在加载配置");

    const failed = mount(ConfigPanel, {
      props: { namespace: null, loading: false, loadError: "配置加载失败" },
    });
    expect(failed.text()).toContain("配置加载失败");
  });

  it("boolean 开关即时上报 patch（未锁定字段取反当前生效值）", async () => {
    // 增加一个未锁定的 boolean 字段
    const ns = fakeNamespace();
    ns.fields.push({
      key: "includeEnv",
      title: "包含运行环境块",
      description: "环境块开关",
      type: "boolean",
      default: true,
    });
    ns.values.includeEnv = true;

    const wrapper = mount(ConfigPanel, {
      props: { namespace: ns, loading: false, loadError: "" },
    });
    const switches = wrapper.findAll("button[role='switch']");
    // 第一个是锁定的 allowPrivateFetch，第二个是 includeEnv
    expect(switches).toHaveLength(2);
    await switches[1].trigger("click");

    const events = wrapper.emitted("patch");
    expect(events).toEqual([["includeEnv", false]]);
  });

  it("env 锁定字段：开关禁用 + 锁标记展示，点击不上报", async () => {
    const wrapper = mount(ConfigPanel, {
      props: { namespace: fakeNamespace(), loading: false, loadError: "" },
    });
    const lockedSwitch = wrapper.find("button[role='switch']");
    expect(lockedSwitch.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("env 锁定");
    expect(wrapper.text()).toContain("VUAGENT_ALLOW_PRIVATE_FETCH");

    await lockedSwitch.trigger("click");
    expect(wrapper.emitted("patch")).toBeUndefined();
  });

  it("number 越界提交被本地钳制到 max 并上报钳制值；范围内变更原样上报", async () => {
    const wrapper = mount(ConfigPanel, {
      props: { namespace: fakeNamespace(), loading: false, loadError: "" },
    });
    const input = wrapper.find("input[type='number']");

    // setValue 在 number input 上会连带触发 change（VTU 行为），无需再显式 trigger
    await input.setValue("9999");
    let events = wrapper.emitted("patch");
    expect(events?.[0]).toEqual(["maxSteps", 100]);
    // 输入框回写为钳制后的值
    expect((input.element as HTMLInputElement).value).toBe("100");

    await input.setValue("20");
    events = wrapper.emitted("patch");
    expect(events?.[1]).toEqual(["maxSteps", 20]);
  });

  it("number 输入清空后提交：不触发 patch（避免 Number(\"\")===0 被钳到 min 静默改值）", async () => {
    const wrapper = mount(ConfigPanel, {
      props: { namespace: fakeNamespace(), loading: false, loadError: "" },
    });
    const input = wrapper.find("input[type='number']");
    await input.setValue("");
    expect(wrapper.emitted("patch")).toBeUndefined();
    // 输入框回显当前生效值
    expect((input.element as HTMLInputElement).value).toBe("15");
  });

  it("select 变更上报新选项；text 变更上报文本", async () => {
    // VaSelect 的弹层 Teleport 到 body：attachTo 挂载后经 combobox 触发器打开再点选项
    const wrapper = mount(ConfigPanel, {
      props: { namespace: fakeNamespace(), loading: false, loadError: "" },
      attachTo: document.body,
    });
    await wrapper.find("[role='combobox']").trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    const autoOption = [...document.querySelectorAll<HTMLElement>("[role='option']")]
      .find((el) => el.textContent?.includes("自动执行 (Auto)"));
    expect(autoOption).toBeTruthy();
    autoOption!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    await wrapper.find("textarea").setValue("先给结论");
    await wrapper.find("textarea").trigger("change");

    const events = wrapper.emitted("patch");
    expect(events?.[0]).toEqual(["defaultPermissionMode", "auto"]);
    expect(events?.[1]).toEqual(["customInstructions", "先给结论"]);
    wrapper.unmount();
  });

  it("其他字段 PATCH 回写触发重渲染时，未提交的输入不被冲掉（Vue 跳过未变化 prop 的 DOM 写）", async () => {
    const ns = fakeNamespace();
    const wrapper = mount(ConfigPanel, {
      props: { namespace: ns, loading: false, loadError: "" },
    });
    // text 字段键入但未提交（textarea 的 setValue 只触发 input，不发 change → 无 patch）
    await wrapper.find("textarea").setValue("尚未提交的草稿");

    // 模拟另一字段 PATCH 成功：父级以服务端生效值替换整个 values 对象
    await wrapper.setProps({
      namespace: { ...ns, values: { ...ns.values, maxSteps: 42 } },
    });

    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe(
      "尚未提交的草稿"
    );
    // 被回写的字段自身值已更新
    expect((wrapper.find("input[type='number']").element as HTMLInputElement).value).toBe("42");
  });

  it("本字段生效值被外部改动（回滚）→ 草稿丢弃并回显外部值", async () => {
    const ns = fakeNamespace();
    const wrapper = mount(ConfigPanel, {
      props: { namespace: ns, loading: false, loadError: "" },
    });
    await wrapper.find("textarea").setValue("将被回滚的草稿");
    // 模拟 PATCH 失败回滚：该字段生效值被外部改写成另一个值
    await wrapper.setProps({
      namespace: { ...ns, values: { ...ns.values, customInstructions: "服务端旧值" } },
    });
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("服务端旧值");
  });

  it("恢复默认（isDefault 翻真）→ 未提交草稿全部失效", async () => {
    const ns = fakeNamespace();
    const wrapper = mount(ConfigPanel, {
      props: { namespace: ns, loading: false, loadError: "" },
    });
    await wrapper.find("textarea").setValue("未提交草稿");
    await wrapper.setProps({
      namespace: { ...ns, values: { ...ns.values, customInstructions: "" }, isDefault: true },
    });
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
  });

  it("reset 按钮仅在有覆盖项时展示并上报 reset", async () => {
    const withOverrides = mount(ConfigPanel, {
      props: { namespace: fakeNamespace({ isDefault: false }), loading: false, loadError: "" },
    });
    const resetBtn = withOverrides.find(".va-settings__config-reset");
    expect(resetBtn.exists()).toBe(true);
    await resetBtn.trigger("click");
    expect(withOverrides.emitted("reset")).toHaveLength(1);

    const allDefault = mount(ConfigPanel, {
      props: { namespace: fakeNamespace({ isDefault: true }), loading: false, loadError: "" },
    });
    expect(allDefault.find(".va-settings__config-reset").exists()).toBe(false);
  });
});
