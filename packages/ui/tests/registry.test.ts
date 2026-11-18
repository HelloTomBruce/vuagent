/**
 * Agent Component Registry 测试（TASK-013）
 * - 模块无顶层副作用：导入后默认注册表为空（tree-shaking 前提）
 * - setupDefaultAgentRegistry() 显式注册内置组件且幂等
 * - propAdapter 对模型输出的脏 args 做空值/类型兜底
 */
import { describe, expect, it } from "vitest";
import {
  getAgentComponent,
  setupDefaultAgentRegistry,
} from "../src/runtime/registry";

describe("Agent Registry - 无顶层副作用", () => {
  it("仅导入模块时默认注册表为空", () => {
    expect(getAgentComponent("ui_approval_card")).toBeUndefined();
    expect(getAgentComponent("ui_trajectory")).toBeUndefined();
  });
});

describe("Agent Registry - setupDefaultAgentRegistry", () => {
  it("显式调用后注册全部内置组件，且重复调用幂等", () => {
    setupDefaultAgentRegistry();
    const approval = getAgentComponent("ui_approval_card");
    expect(approval).toBeTruthy();
    expect(getAgentComponent("ui_trajectory")).toBeTruthy();
    expect(getAgentComponent("ui_code_diff")).toBeTruthy();
    expect(getAgentComponent("ui_metric_chart")).toBeTruthy();
    expect(getAgentComponent("ui_agent_plan")).toBeTruthy();
    expect(getAgentComponent("ui_file_tree")).toBeTruthy();

    // 幂等：再次调用不覆盖、不报错
    setupDefaultAgentRegistry();
    expect(getAgentComponent("ui_approval_card")).toBe(approval);
  });
});

describe("Agent Registry - propAdapter 容错", () => {
  const ctx = { toolCallId: "t1", status: "executing" as const };

  it("approval: args 为 null 时兜底为默认审批单", () => {
    setupDefaultAgentRegistry();
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!(null as unknown as Record<string, any>, ctx);
    expect(props.title).toBe("审批申请");
    // executing 态且无 countdown 字段 → 不限时（undefined）
    expect(props.countdown).toBeUndefined();
    expect(props.risk).toBeUndefined();
    // streaming 态恒为 0（未执行完不启动倒计时）
    const streaming = entry.propAdapter!(null as unknown as Record<string, any>, {
      ...ctx,
      status: "streaming" as const,
    });
    expect(streaming.countdown).toBe(0);
    expect(streaming.title).toBe("正在生成审批单...");
  });

  it("approval: 字段类型错乱时不透出脏值", () => {
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!(
      { title: 123, risk: "bogus", countdown: "30", shortcuts: "yes" },
      ctx,
    );
    expect(props.title).toBe("审批申请");
    expect(props.risk).toBeUndefined();
    expect(props.countdown).toBeUndefined(); // "30" 非 number → 兜底
    expect(props.shortcuts).toBe(true); // executing 态兜底
  });

  it("approval: 不透出模型 args 中的 approveShortcut（安全默认不可被模型开启）", () => {
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!({ title: "t", approveShortcut: true }, ctx);
    expect("approveShortcut" in props).toBe(false);
  });

  it("metric_chart: 枚举与数组兜底", () => {
    const entry = getAgentComponent("ui_metric_chart")!;
    const props = entry.propAdapter!({ chartType: "pie", series: "not-array" }, ctx);
    expect(props.chartType).toBe("bar");
    expect(props.series).toEqual([]);
    expect(props.title).toBe("指标趋势");
  });

  it("code_diff: 文本缺省为空串、layout 枚举兜底", () => {
    const entry = getAgentComponent("ui_code_diff")!;
    const props = entry.propAdapter!({}, ctx);
    expect(props.oldText).toBe("");
    expect(props.newText).toBe("");
    expect(props.layout).toBe("unified");
  });

  it("approval: onDeny 回传时非法 reason 归一为 manual", () => {
    const payloads: unknown[] = [];
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!({ title: "t" }, {
      ...ctx,
      onSubmitAction: (p: unknown) => {
        payloads.push(p);
      },
    });
    props.onDeny({ weird: true });
    expect(payloads).toEqual([{ approved: false, reason: "manual" }]);
  });
});
