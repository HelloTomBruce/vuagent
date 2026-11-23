import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import {
  useCardRegistry,
  registerCardComponent,
  unregisterCardComponent,
  getCardComponent,
  clearCardComponents,
} from "../src/composables/useCardRegistry";

describe("useCardRegistry (场景组件注册表)", () => {
  const DummyStockCard = defineComponent({
    name: "DummyStockCard",
    props: { symbol: String, price: Number },
    setup(props) {
      return () => h("div", { class: "stock-card" }, `${props.symbol}: ${props.price}`);
    },
  });

  beforeEach(() => {
    clearCardComponents();
  });

  it("能成功注册、查询与注销自定义组件", () => {
    expect(getCardComponent("stock_quote")).toBeUndefined();

    registerCardComponent("stock_quote", DummyStockCard);
    expect(getCardComponent("stock_quote")).toBe(DummyStockCard);

    const { components } = useCardRegistry();
    expect(components.value.has("stock_quote")).toBe(true);

    const unregistered = unregisterCardComponent("stock_quote");
    expect(unregistered).toBe(true);
    expect(getCardComponent("stock_quote")).toBeUndefined();
  });

  it("多次注册可覆盖既有组件", () => {
    const AnotherCard = defineComponent({ name: "AnotherCard" });
    registerCardComponent("test_card", DummyStockCard);
    expect(getCardComponent("test_card")).toBe(DummyStockCard);

    registerCardComponent("test_card", AnotherCard);
    expect(getCardComponent("test_card")).toBe(AnotherCard);
  });
});
