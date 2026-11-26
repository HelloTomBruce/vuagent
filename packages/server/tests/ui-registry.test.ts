import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { UIComponentRegistry } from "../src/core/ui-registry.js";
import { createHarnessServer, CoreSystemTools } from "../src/server.js";
import type { UIComponentDefinition } from "@vuagent/protocol";

describe("UIComponentRegistry (开放组件注册中心)", () => {
  const StockCardSchema = Type.Object({
    symbol: Type.String({ description: "股票代号" }),
    price: Type.Number({ description: "最新价格" }),
  });

  const stockComponentDef: UIComponentDefinition = {
    name: "stock_quote_card",
    title: "股票行情卡片",
    description: "当用户查询股票实时报价时渲染行情卡片",
    schema: StockCardSchema,
  };

  it("能注册并获取自定义 UI 组件", () => {
    const registry = new UIComponentRegistry();
    registry.register(stockComponentDef);

    expect(registry.get("stock_quote_card")).toBe(stockComponentDef);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].title).toBe("股票行情卡片");
  });

  it("转换为大模型可调用的 HarnessTool，并返回正确的组件渲染载荷", async () => {
    const registry = new UIComponentRegistry();
    registry.register(stockComponentDef);

    const tools = registry.toHarnessTools();
    expect(tools).toHaveLength(1);

    const tool = tools[0];
    expect(tool.name).toBe("stock_quote_card");
    expect(tool.description).toBe("当用户查询股票实时报价时渲染行情卡片");
    expect(tool.riskLevel).toBe("low");
    expect(tool.writesWorkspace).toBe(false);

    const fakeCtx: any = {
      args: { symbol: "AAPL", price: 180.5 },
    };
    const result = await tool.execute(fakeCtx);
    expect(result).toEqual({
      rendered: true,
      component: "stock_quote_card",
      props: { symbol: "AAPL", price: 180.5 },
    });
  });

  it("在 createHarnessServer 时通过 customUIComponents 挂载，并出现在 GET /api/tools 中", async () => {
    const { app, toolRegistry, uiRegistry } = createHarnessServer({
      dbPath: ":memory:",
      customUIComponents: [stockComponentDef],
    });

    // 内部注册表已包含
    expect(uiRegistry.get("stock_quote_card")).toBeDefined();
    expect(toolRegistry.get("stock_quote_card")).toBeDefined();

    // 核心原子工具对齐
    expect(CoreSystemTools.map((t) => t.name)).toEqual([
      "fs_read",
      "fs_write",
      "fs_edit",
      "bash_run",
    ]);

    // REST API 正常返回
    const res = await app.request("/api/tools");
    expect(res.status).toBe(200);
    const tools = await res.json();
    const stockTool = tools.find((t: any) => t.name === "stock_quote_card");
    expect(stockTool).toBeDefined();
    expect(stockTool.description).toBe("当用户查询股票实时报价时渲染行情卡片");
    expect(stockTool.source).toBe("ui_component");

    const defaultDeployTool = tools.find((t: any) => t.name === "ui_deploy_status");
    expect(defaultDeployTool).toBeDefined();
    expect(defaultDeployTool.source).toBe("ui_component");
  });

  it("TASK-089：interaction 透传进 HarnessTool 扩展字段；未声明组件不带该键", () => {
    const registry = new UIComponentRegistry();
    registry.register(stockComponentDef);
    registry.register({
      name: "deploy_form",
      title: "创建部署",
      description: "收集部署参数",
      schema: Type.Object({ title: Type.String() }),
      interaction: {
        level: "L2",
        resultSchema: Type.Object({ env: Type.String({ description: "部署环境" }) }),
      },
    });

    const tools = registry.toHarnessTools();
    const plain = tools.find((t) => t.name === "stock_quote_card")!;
    const interactive = tools.find((t) => t.name === "deploy_form")!;

    // 未声明组件：无 interaction 键（默认路径行为逐字节不变的判别依据）
    expect("interaction" in plain).toBe(false);
    // 声明组件：interaction 原样透传
    expect(interactive.interaction?.level).toBe("L2");
    expect(interactive.interaction?.resultSchema).toBeDefined();
  });

  it("TASK-089：注册期定义校验——L2 缺 resultSchema 直接抛错（错误前置到定义期）", () => {
    const registry = new UIComponentRegistry();
    expect(() =>
      registry.register({
        name: "bad_form",
        title: "坏表单",
        description: "缺少 resultSchema 的 L2",
        schema: Type.Object({}),
        interaction: { level: "L2" },
      })
    ).toThrow(/resultSchema/);
  });
});
