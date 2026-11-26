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
import { formFieldErrors } from "../src/runtime/form-errors";

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
    // TASK-077 协议卡片扩展批
    expect(getAgentComponent("ui_task_board")).toBeTruthy();
    expect(getAgentComponent("ui_change_summary")).toBeTruthy();
    expect(getAgentComponent("ui_comment_thread")).toBeTruthy();
    expect(getAgentComponent("ui_ai_answer")).toBeTruthy();

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

  it("approval: onDeny 回传时非法 reason 归一为 manual（信封形态）", () => {
    const payloads: unknown[] = [];
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!({ title: "t" }, {
      ...ctx,
      onSubmitAction: (p: unknown) => {
        payloads.push(p);
      },
    });
    props.onDeny({ weird: true });
    expect(payloads).toEqual([
      {
        kind: "submit",
        values: { approved: false, note: "manual" },
        meta: { editedFields: [] },
      },
    ]);
  });

  it("task_board: columns/tasks 非数组兜底为空数组", () => {
    const entry = getAgentComponent("ui_task_board")!;
    const props = entry.propAdapter!({ columns: null, tasks: "bad" }, ctx);
    expect(props.columns).toEqual([]);
    expect(props.tasks).toEqual([]);
  });

  it("change_summary: 数值字段类型兜底", () => {
    const entry = getAgentComponent("ui_change_summary")!;
    const props = entry.propAdapter!(
      { files: [{ path: "a.ts" }], duration: "120", toolCalls: NaN, finishedAt: 123 },
      ctx,
    );
    expect(props.files).toEqual([{ path: "a.ts" }]);
    expect(props.duration).toBeUndefined();
    expect(props.toolCalls).toBeUndefined();
    expect(props.finishedAt).toBe(123);
  });

  it("comment_thread: 契约卡关闭输入框（记录态不做无后端发布交互）", () => {
    const entry = getAgentComponent("ui_comment_thread")!;
    const props = entry.propAdapter!({ comments: [{ id: "c1", author: "agent", text: "x" }] }, ctx);
    expect(props.composer).toBe(false);
    expect(props.comments).toHaveLength(1);
    expect(props.maxHeight).toBe(360);
  });

  it("ai_answer: answer 缺省为空串，streaming 跟随 status", () => {
    const entry = getAgentComponent("ui_ai_answer")!;
    const executing = entry.propAdapter!({ sources: [] }, ctx);
    expect(executing.answer).toBe("");
    expect(executing.streaming).toBe(false);
    const streaming = entry.propAdapter!({}, { ...ctx, status: "streaming" as const });
    expect(streaming.streaming).toBe(true);
  });
});

describe("Agent Registry - 交互信封（TASK-090，设计文档 §3）", () => {
  const ctx = { toolCallId: "t1", status: "executing" as const };

  const collectPayloads = () => {
    const payloads: unknown[] = [];
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!({ title: "t" }, {
      ...ctx,
      onSubmitAction: (p: unknown) => {
        payloads.push(p);
      },
    });
    return { props, payloads };
  };

  it("approval_card 声明 L1 交互等级（决策型，非纯展示）", () => {
    setupDefaultAgentRegistry();
    expect(getAgentComponent("ui_approval_card")!.interaction).toEqual({ level: "L1" });
    // 纯展示组件不声明 interaction（缺省 L0，无回传通道）
    expect(getAgentComponent("ui_trajectory")!.interaction).toBeUndefined();
  });

  it("onApprove 产出 submit 信封：values.approved=true", () => {
    const { props, payloads } = collectPayloads();
    props.onApprove();
    expect(payloads).toEqual([
      {
        kind: "submit",
        values: { approved: true },
        meta: { editedFields: [] },
      },
    ]);
  });

  it("onDeny 产出 submit 信封的 values 形态（deny 不是 cancel）", () => {
    const { props, payloads } = collectPayloads();
    props.onDeny("timeout");
    expect(payloads).toEqual([
      {
        kind: "submit",
        values: { approved: false, note: "timeout" },
        meta: { editedFields: [] },
      },
    ]);
    // 信封形状快照：判别联合的 kind/values/meta 三要素齐全，无旧形态 approved/reason 顶属 key
    const envelope = payloads[0] as Record<string, any>;
    expect(Object.keys(envelope).sort()).toEqual(["kind", "meta", "values"]);
    expect("approved" in envelope).toBe(false);
  });

  it("双保险：非 executing 态组件内自查仍然拦截（渲染层守卫之外）", () => {
    const payloads: unknown[] = [];
    const entry = getAgentComponent("ui_approval_card")!;
    const props = entry.propAdapter!({ title: "t" }, {
      toolCallId: "t1",
      status: "done" as const,
      onSubmitAction: (p: unknown) => {
        payloads.push(p);
      },
    });
    props.onApprove();
    props.onDeny("manual");
    expect(payloads).toEqual([]);
  });
});

describe("Agent Registry - ui_agent_plan L3 协作回传（Phase 3，设计文档 §2/§3）", () => {
  const PLAN_ARGS = {
    title: "发布计划",
    editable: true,
    collaborative: true,
    steps: [
      { id: "s1", title: "构建镜像", status: "done" },
      { id: "s2", title: "推送仓库", status: "error" },
    ],
  };

  const collectProps = (
    args: Record<string, any>,
    status: "streaming" | "executing" | "done" | "error" = "executing",
  ) => {
    const payloads: unknown[] = [];
    const entry = getAgentComponent("ui_agent_plan")!;
    const ctx = {
      toolCallId: "call-plan-1",
      status,
      onSubmitAction: (p: unknown) => {
        payloads.push(p);
      },
    };
    const props = entry.propAdapter!(args, ctx);
    return { props, payloads, ctx };
  };

  it("interaction 声明：L3 + timeoutMeaning cancel + 静态 resultSchema（steps/retryStepId）", () => {
    setupDefaultAgentRegistry();
    const interaction = getAgentComponent("ui_agent_plan")!.interaction!;
    expect(interaction.level).toBe("L3");
    expect(interaction.timeoutMeaning).toBe("cancel");
    const schema = interaction.resultSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.steps.type).toBe("array");
    expect(properties.retryStepId.type).toBe("string");
    // deriveResultSchema 不声明（形状静态，与 ui_form 的 args 派生形态二选一）
    expect(interaction.deriveResultSchema).toBeUndefined();
  });

  it("collaborative=true + executing：update:steps → patch 信封（values.steps 逐项收敛、脏数据丢弃）", () => {
    const { props, payloads } = collectProps(PLAN_ARGS);
    (props as Record<string, any>)["onUpdate:steps"]([
      { id: "s1", title: "构建镜像（改名）", status: "done", bogus: "extra" },
      { id: "s2", title: "推送仓库", status: "error" },
      { title: "脏项缺 id" },
      null,
      "str",
      { id: "s3", title: "新增步骤" },
    ]);
    expect(payloads).toEqual([
      {
        kind: "patch",
        values: {
          steps: [
            { id: "s1", title: "构建镜像（改名）", status: "done" },
            { id: "s2", title: "推送仓库", status: "error" },
            { id: "s3", title: "新增步骤" },
          ],
        },
        meta: { editedFields: ["steps"] },
      },
    ]);
  });

  it("collaborative=true + executing：retry → submit 信封（values.retryStepId，终态唤醒重试）", () => {
    const { props, payloads } = collectProps(PLAN_ARGS);
    (props as Record<string, any>).onRetry({ id: "s2", title: "推送仓库", status: "error" });
    expect(payloads).toEqual([
      {
        kind: "submit",
        values: { retryStepId: "s2" },
        meta: { editedFields: ["retryStepId"] },
      },
    ]);
    // 信封形状快照：判别联合三要素，无旧形态顶属 key
    const envelope = payloads[0] as Record<string, any>;
    expect(Object.keys(envelope).sort()).toEqual(["kind", "meta", "values"]);
  });

  it("retry 脏步骤（id 非法/缺失）不发射", () => {
    const { props, payloads } = collectProps(PLAN_ARGS);
    const p = props as Record<string, any>;
    p.onRetry({ id: 42, title: "x" });
    p.onRetry({ title: "无 id" });
    p.onRetry(null);
    p.onRetry(undefined);
    expect(payloads).toEqual([]);
  });

  it("confirm → submit 空 values 信封（终态，server 合并此前 patch steps 落账）", () => {
    const { props, payloads } = collectProps(PLAN_ARGS);
    (props as Record<string, any>).onConfirm();
    expect(payloads).toEqual([{ kind: "submit", values: {}, meta: { editedFields: [] } }]);
  });

  it("cancel → cancel 信封（终态一等公民，非错误）", () => {
    const { props, payloads } = collectProps(PLAN_ARGS);
    (props as Record<string, any>).onCancel();
    expect(payloads).toEqual([{ kind: "cancel" }]);
  });

  it("双保险：发射前 ctx.status 自查——闭包存活期间状态翻转为非 executing 后全部拦截", () => {
    const { props, payloads, ctx } = collectProps(PLAN_ARGS, "executing");
    (ctx as { status: string }).status = "done";
    const p = props as Record<string, any>;
    p["onUpdate:steps"]([{ id: "s1", title: "x" }]);
    p.onRetry({ id: "s2", title: "x" });
    p.onConfirm();
    p.onCancel();
    expect(payloads).toEqual([]);
  });

  it("非 executing（done/streaming）：propAdapter 不透出任何协作通道（渲染层守卫之外第一道收敛）", () => {
    for (const status of ["done", "streaming"] as const) {
      const { props } = collectProps(PLAN_ARGS, status);
      expect("collaborative" in props).toBe(false);
      expect("onUpdate:steps" in props).toBe(false);
      expect("onRetry" in props).toBe(false);
      expect("onConfirm" in props).toBe(false);
      expect("onCancel" in props).toBe(false);
      expect("fieldErrors" in props).toBe(false);
    }
  });

  it("collaborative 缺省/false：输出不含协作 prop（视觉/行为零变化回归）", () => {
    const { props } = collectProps(
      { title: "t", editable: true, steps: [{ id: "a", title: "A" }] },
      "executing",
    );
    expect("collaborative" in props).toBe(false);
    expect("onConfirm" in props).toBe(false);
    expect(props.steps).toEqual([{ id: "a", title: "A" }]);
    const off = collectProps({ collaborative: false }, "executing");
    expect("collaborative" in off.props).toBe(false);
  });

  it("fieldErrors 通道：formFieldErrors 写入 → 协作态透传（L3 422 就地回显）", () => {
    formFieldErrors.set("call-plan-1", { steps: "步骤数组应为对象列表" });
    const { props } = collectProps(PLAN_ARGS);
    expect((props as Record<string, any>).fieldErrors).toEqual({
      steps: "步骤数组应为对象列表",
    });
    formFieldErrors.delete("call-plan-1");
  });

  it("渲染 steps 收敛：脏步骤丢弃、非法字段剥离（不可信 args 守卫，同 ui_form 先例）", () => {
    const { props } = collectProps({
      steps: [
        { id: "ok", title: "正常", status: "done", detail: "d", startedAt: 1, duration: 2 },
        { id: 123, title: "坏id" },
        { id: "no-title" },
        { id: "bad-status", title: "坏status", status: "hacker" },
        null,
        "str",
      ],
    });
    expect(props.steps).toEqual([
      { id: "ok", title: "正常", status: "done", detail: "d", startedAt: 1, duration: 2 },
      { id: "bad-status", title: "坏status" },
    ]);
  });
});
