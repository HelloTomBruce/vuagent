// @vitest-environment happy-dom
/**
 * VaTurnRail —— 右侧轮次快速跳转轨
 * 覆盖：轮次门槛隐藏 / 标记与 aria / 点击定位几何 / 滚动跟随（scroll-spy）/
 * 键盘上下移动 / 悬停预览 / 锚点缺失静默降级
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import VaTurnRail from "../src/components/turn-rail/VaTurnRail.vue";
import type { TurnRailItem } from "../src/components/turn-rail/types";

/** happy-dom 的 getBoundingClientRect 恒为 0：按「容器顶 / 各锚点顶」伪造几何位置 */
function rect(top: number): DOMRect {
  return {
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

interface Harness {
  scroller: HTMLElement;
  anchors: Record<string, HTMLElement>;
  scrollTo: ReturnType<typeof vi.fn>;
}

/** 造一个带锚点的滚动容器；tops 为各锚点相对容器顶边的偏移 */
function makeScrollContainer(tops: Record<string, number>): Harness {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  scroller.getBoundingClientRect = () => rect(0);

  const anchors: Record<string, HTMLElement> = {};
  for (const [id, top] of Object.entries(tops)) {
    const node = document.createElement("div");
    node.setAttribute("data-turn-id", id);
    node.getBoundingClientRect = () => rect(top);
    scroller.appendChild(node);
    anchors[id] = node;
  }

  const scrollTo = vi.fn();
  (scroller as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
  document.body.appendChild(scroller);
  return { scroller, anchors, scrollTo };
}

function items(...labels: string[]): TurnRailItem[] {
  return labels.map((label, index) => ({ id: `t${index + 1}`, label, role: "user" as const }));
}

/** 等一帧（rAF 已 stub 成 setTimeout 0） */
const frame = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("VaTurnRail", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("轮次数 ≤ minItems 时整条轨隐藏（默认单轮不显示）", () => {
    const one = mount(VaTurnRail, { props: { items: items("只有一轮") } });
    expect(one.find("nav").exists()).toBe(false);

    const two = mount(VaTurnRail, { props: { items: items("第一轮", "第二轮") } });
    expect(two.find("nav").exists()).toBe(true);

    // minItems=0 时强制常显
    const force = mount(VaTurnRail, { props: { items: items("只有一轮"), minItems: 0 } });
    expect(force.find("nav").exists()).toBe(true);
  });

  it("每轮一枚标记，aria-label 用轮次文案、缺文案回退「第 N 轮」", () => {
    const wrapper = mount(VaTurnRail, {
      props: { items: [{ id: "t1", label: "检查 Pod 状态" }, { id: "t2" }] },
    });

    const dots = wrapper.findAll(".va-turn-rail__dot");
    expect(dots).toHaveLength(2);
    expect(dots[0].attributes("aria-label")).toBe("跳到检查 Pod 状态");
    expect(dots[1].attributes("aria-label")).toBe("跳到第 2 轮");
    expect(wrapper.find("nav").attributes("aria-label")).toBe("对话轮次快速跳转");

    // role 决定点形态：用户实点 / 助手空点
    expect(dots[0].classes()).toContain("va-turn-rail__dot--user");
    const assistant = mount(VaTurnRail, {
      props: { items: [{ id: "a1", role: "assistant" }, { id: "a2", role: "assistant" }] },
    });
    expect(assistant.find(".va-turn-rail__dot").classes()).toContain("va-turn-rail__dot--assistant");
  });

  it("点击标记按「容器滚动位移 + 锚点偏移 - 留白」定位，并广播 select / update:activeId", async () => {
    const { scroller, scrollTo } = makeScrollContainer({ t1: -400, t2: 300 });
    scroller.scrollTop = 100;

    const wrapper = mount(VaTurnRail, {
      props: { items: items("第一轮", "第二轮"), container: scroller },
    });
    await frame();

    await wrapper.findAll(".va-turn-rail__dot")[1].trigger("click");

    // 100（当前 scrollTop） + 300（锚点相对容器顶） - 16（默认 offset）
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 384 });
    expect(wrapper.emitted("select")?.[0]).toEqual(["t2", 1]);
    expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["t2"]);
  });

  it("滚动跟随：越过阈值的最后一个锚点即当前轮，aria-current 同步", async () => {
    const { scroller } = makeScrollContainer({ t1: -320, t2: 40, t3: 520 });
    const wrapper = mount(VaTurnRail, {
      props: { items: items("一", "二", "三"), container: scroller },
    });
    await frame();

    // 初始：t1/t2 已越过阈值（≤96），t3 未越过 → 当前 = t2
    expect(wrapper.findAll(".va-turn-rail__dot")[1].attributes("aria-current")).toBe("true");

    // 上翻回到 t1 附近：t2 的顶边被推到阈值之下 → 当前回落到 t1
    (scroller.children[1] as HTMLElement).getBoundingClientRect = () => rect(140);
    scroller.dispatchEvent(new Event("scroll"));
    await frame();

    const dots = wrapper.findAll(".va-turn-rail__dot");
    expect(dots[0].attributes("aria-current")).toBe("true");
    expect(dots[1].attributes("aria-current")).toBeUndefined();
    expect(wrapper.emitted("update:activeId")?.at(-1)).toEqual(["t1"]);
  });

  it("贴底时当前轮 = 最后一轮（跳转被夹到最大 scrollTop 也能高亮）", async () => {
    // 末尾锚点顶边 300px，远超 96px 阈值 → 纯几何会判成 t2；但容器已贴底，
    // 用户点最后一枚标记、跳转被夹到最大 scrollTop 时，高亮必须跟到 t3，否则「点了没反应」
    const { scroller } = makeScrollContainer({ t1: -600, t2: -200, t3: 300 });
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
    scroller.scrollTop = 600; // 1000 - 600 - 400 = 0 → 贴底

    const wrapper = mount(VaTurnRail, {
      props: { items: items("一", "二", "三"), container: scroller },
    });
    await frame();

    expect(wrapper.findAll(".va-turn-rail__dot")[2].attributes("aria-current")).toBe("true");
    expect(wrapper.findAll(".va-turn-rail__dot")[1].attributes("aria-current")).toBeUndefined();

    // 一屏放得下（不可滚）时不套用贴底口径：回落到几何，首轮即当前轮
    const short = makeScrollContainer({ t1: 20, t2: 120 });
    Object.defineProperty(short.scroller, "scrollHeight", { value: 200, configurable: true });
    Object.defineProperty(short.scroller, "clientHeight", { value: 200, configurable: true });

    const fit = mount(VaTurnRail, {
      props: { items: items("一", "二"), container: short.scroller },
    });
    await frame();
    expect(fit.findAll(".va-turn-rail__dot")[0].attributes("aria-current")).toBe("true");
  });

  it("键盘 ↓/Home/End 在轨内移动即跳转，且焦点跟随", async () => {
    const { scroller, scrollTo } = makeScrollContainer({ t1: 100, t2: 500, t3: 900 });
    const wrapper = mount(VaTurnRail, {
      props: { items: items("一", "二", "三"), container: scroller },
      attachTo: document.body,
    });
    await frame();

    const nav = wrapper.find("nav");
    await nav.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["t2", 1]);

    await nav.trigger("keydown", { key: "End" });
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["t3", 2]);

    await nav.trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["t1", 0]);
    expect(scrollTo).toHaveBeenCalled();
    expect(document.activeElement).toBe(wrapper.findAll(".va-turn-rail__dot")[0].element);
  });

  it("悬停显示预览卡（#序号 + 文案），移出即收起", async () => {
    const wrapper = mount(VaTurnRail, {
      props: { items: items("重构 SSE 消费循环", "补单测") },
    });

    const first = wrapper.findAll(".va-turn-rail__dot")[0];
    await first.trigger("mouseenter");
    await frame();

    const preview = wrapper.find(".va-turn-rail__preview");
    expect(preview.exists()).toBe(true);
    expect(preview.attributes("role")).toBe("tooltip");
    expect(preview.text()).toContain("#1");
    expect(preview.text()).toContain("重构 SSE 消费循环");

    await first.trigger("mouseleave");
    await frame();
    expect(wrapper.find(".va-turn-rail__preview").exists()).toBe(false);
  });

  it("锚点缺失时点击不报错、不滚动，但选中状态照常广播", async () => {
    const { scroller, scrollTo } = makeScrollContainer({ t1: 0 });
    const wrapper = mount(VaTurnRail, {
      props: { items: items("有锚点", "无锚点"), container: scroller },
    });
    await frame();

    await wrapper.findAll(".va-turn-rail__dot")[1].trigger("click");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(wrapper.emitted("select")?.[0]).toEqual(["t2", 1]);
  });

  it("preview=false 时不渲染预览卡", async () => {
    const wrapper = mount(VaTurnRail, {
      props: { items: items("一", "二"), preview: false },
    });
    await wrapper.findAll(".va-turn-rail__dot")[0].trigger("mouseenter");
    await frame();
    expect(wrapper.find(".va-turn-rail__preview").exists()).toBe(false);
  });

  it("流式/失败状态挂对应修饰类（脉冲点 / 危险点）", () => {
    const wrapper = mount(VaTurnRail, {
      props: {
        items: [
          { id: "t1", status: "streaming" },
          { id: "t2", status: "error" },
        ],
      },
    });
    const dots = wrapper.findAll(".va-turn-rail__dot");
    expect(dots[0].classes()).toContain("va-turn-rail__dot--streaming");
    expect(dots[1].classes()).toContain("va-turn-rail__dot--error");
  });

  it("受控 activeId 优先于滚动自算", async () => {
    const { scroller } = makeScrollContainer({ t1: -300, t2: 20 });
    const wrapper = mount(VaTurnRail, {
      props: { items: items("一", "二"), container: scroller, activeId: "t1" },
    });
    await frame();

    expect(wrapper.findAll(".va-turn-rail__dot")[0].attributes("aria-current")).toBe("true");

    await wrapper.setProps({ activeId: "t2" });
    expect(wrapper.findAll(".va-turn-rail__dot")[1].attributes("aria-current")).toBe("true");
  });
});
