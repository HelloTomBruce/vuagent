// @vitest-environment happy-dom
/**
 * ui_agent_plan 协作回传 dom 测试（Phase 3，L3 patch/submit 信封发射）：
 * 协作 footer 渲染开关 / 四条回传通道经 VaAgentRenderer 全链路（渲染层守卫 →
 * propAdapter → onSubmitAction）/ 非 executing 终态零可交互 / fieldErrors 回显。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import VaAgentRenderer from "../src/runtime/VaAgentRenderer.vue";
import { setupDefaultAgentRegistry } from "../src/runtime/registry";
import { formFieldErrors } from "../src/runtime/form-errors";
import { clearAllPlanStepsMirrors } from "../src/runtime/plan-steps-mirror";

const COLLAB_EDITABLE_ARGS = {
  title: "发布计划",
  editable: true,
  collaborative: true,
  steps: [
    { id: "s1", title: "构建镜像", status: "done" },
    { id: "s2", title: "推送仓库", status: "pending" },
  ],
};

const COLLAB_RUN_ARGS = {
  title: "执行计划",
  collaborative: true,
  steps: [
    { id: "s1", title: "构建镜像", status: "done" },
    { id: "s2", title: "推送仓库", status: "error" },
  ],
};

beforeAll(() => {
  setupDefaultAgentRegistry();
});

// steps 镜像 / fieldErrors 是模块级单例：用例间清理，避免跨用例状态污染
afterEach(() => {
  clearAllPlanStepsMirrors();
  formFieldErrors.clear();
});

const mountPlan = (
  args: Record<string, any>,
  status: "streaming" | "executing" | "done" = "executing",
) => {
  const actions: unknown[] = [];
  const w = mount(VaAgentRenderer, {
    props: {
      toolCallId: "call-plan-1",
      componentName: "ui_agent_plan",
      args,
      status,
      onSubmitAction: async (p: unknown) => {
        actions.push(p);
      },
    },
  });
  return { w, actions };
};

const buttonByText = (w: ReturnType<typeof mountPlan>["w"], text: string) =>
  w.findAll("button").find((b) => b.text().trim() === text);

describe("ui_agent_plan 协作 footer 渲染开关", () => {
  it("collaborative=true + executing：渲染「确认计划」主按钮与「放弃」次按钮", () => {
    const { w } = mountPlan(COLLAB_EDITABLE_ARGS);
    const confirm = buttonByText(w, "确认计划");
    const giveup = buttonByText(w, "放弃");
    expect(confirm).toBeTruthy();
    expect(giveup).toBeTruthy();
    expect(confirm!.attributes("disabled")).toBeUndefined(); // 挂起态可点
  });

  it("collaborative 缺省：无协作 footer（视觉/行为零变化回归）", () => {
    const { w } = mountPlan({ ...COLLAB_EDITABLE_ARGS, collaborative: undefined });
    expect(buttonByText(w, "确认计划")).toBeUndefined();
    expect(buttonByText(w, "放弃")).toBeUndefined();
  });

  it("collaborative=true 但终态（done）：协作出口消失（终态后无可交互回传）", () => {
    const { w } = mountPlan(COLLAB_EDITABLE_ARGS, "done");
    expect(buttonByText(w, "确认计划")).toBeUndefined();
    expect(buttonByText(w, "放弃")).toBeUndefined();
  });
});

describe("ui_agent_plan 四条回传通道（经 VaAgentRenderer 全链路）", () => {
  it("editable 编辑步骤 → patch 信封（完整 steps 数组 + editedFields，不终结挂起）", async () => {
    const { w, actions } = mountPlan(COLLAB_EDITABLE_ARGS);
    await w.find(".va-plan__rename").trigger("click");
    const input = w.find(".va-plan__edit-row .va-plan__input");
    expect(input.exists()).toBe(true);
    await input.setValue("构建镜像 v2");
    await input.trigger("keydown.enter");

    expect(actions.length).toBe(1);
    expect(actions[0]).toEqual({
      kind: "patch",
      values: {
        steps: [
          { id: "s1", title: "构建镜像 v2", status: "done" },
          { id: "s2", title: "推送仓库", status: "pending" },
        ],
      },
      meta: { editedFields: ["steps"] },
    });
  });

  it("运行态失败步骤重试 → submit 信封（values.retryStepId，终态）", async () => {
    const { w, actions } = mountPlan(COLLAB_RUN_ARGS);
    const retry = w.find(".va-plan__retry");
    expect(retry.exists()).toBe(true);
    await retry.trigger("click");

    expect(actions).toEqual([
      {
        kind: "submit",
        values: { retryStepId: "s2" },
        meta: { editedFields: ["retryStepId"] },
      },
    ]);
  });

  it("确认计划 → submit 空 values 信封（终态，server 合并此前 patch steps）", async () => {
    const { w, actions } = mountPlan(COLLAB_EDITABLE_ARGS);
    await buttonByText(w, "确认计划")!.trigger("click");
    expect(actions).toEqual([{ kind: "submit", values: {}, meta: { editedFields: [] } }]);
  });

  it("放弃 → cancel 信封（终态一等公民，非错误）", async () => {
    const { w, actions } = mountPlan(COLLAB_EDITABLE_ARGS);
    await buttonByText(w, "放弃")!.trigger("click");
    expect(actions).toEqual([{ kind: "cancel" }]);
  });
});

describe("ui_agent_plan fieldErrors 通道（§4.2 L3 重填闭环）", () => {
  it("formFieldErrors 写入 → 协作 footer 就地回显 server 422 错误", () => {
    formFieldErrors.set("call-plan-1", { steps: "步骤 2 标题不能为空" });
    const { w } = mountPlan(COLLAB_EDITABLE_ARGS);
    expect(w.findAll(".va-plan__error").map((e) => e.text())).toContain(
      "steps：步骤 2 标题不能为空"
    );
    formFieldErrors.delete("call-plan-1");
  });
});
