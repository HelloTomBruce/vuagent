import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/**
 * 场景③ 前端重构助手：生成重构预览（只读）
 * 返回 ui_code_change 卡片（内嵌 VaFileTree + VaCodeDiff + VaChangeSummary）
 */
export const CodeRefactorPreviewTool: HarnessTool = {
  name: "code_refactor_preview",
  description: "对指定模块生成重构预览：变更文件树、逐文件代码 diff 与变更摘要（内置仿真仓库）",
  parameters: Type.Object({
    target: Type.String({ description: "要重构的模块，例如 OrderService" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const target = String(ctx.args.target || "OrderService");
    const now = Date.now();
    return {
      rendered: true,
      component: "ui_code_change",
      props: {
        target,
        summary: {
          duration: 26_800,
          toolCalls: 7,
          files: [
            { path: "src/services/OrderService.ts", status: "M", additions: 12, deletions: 208 },
            { path: "src/services/order/OrderCreator.ts", status: "A", additions: 96, deletions: 0 },
            { path: "src/services/order/OrderPricer.ts", status: "A", additions: 74, deletions: 0 },
            { path: "src/services/order/OrderRepo.ts", status: "A", additions: 52, deletions: 0 },
          ],
        },
        tree: [
          {
            path: "src",
            type: "dir",
            children: [
              {
                path: "src/services",
                type: "dir",
                children: [
                  { path: "src/services/OrderService.ts", type: "file", status: "M" },
                  {
                    path: "src/services/order",
                    type: "dir",
                    children: [
                      { path: "src/services/order/OrderCreator.ts", type: "file", status: "A" },
                      { path: "src/services/order/OrderPricer.ts", type: "file", status: "A" },
                      { path: "src/services/order/OrderRepo.ts", type: "file", status: "A" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        diffs: [
          {
            fileName: "src/services/OrderService.ts",
            oldText: [
              "import { prisma } from '../db';",
              "import { calcDiscount, calcTax } from './money';",
              "",
              "export class OrderService {",
              "  async createOrder(input: CreateOrderInput) {",
              "    // 校验库存",
              "    const items = await this.validateStock(input.items);",
              "    // 计算价格：折扣 + 税费 + 运费（208 行内联逻辑）",
              "    const price = calcDiscount(input);",
              "    const tax = calcTax(price);",
              "    const shipping = input.weight > 5 ? 12 : 0;",
              "    const total = price + tax + shipping;",
              "    // 落库 + 发事件 + 清购物车（全部内联）",
              "    const order = await prisma.order.create({ data: { total } });",
              "    await eventBus.emit('order.created', order);",
              "    await cart.clear(input.userId);",
              "    return order;",
              "  }",
              "}",
            ].join("\n"),
            newText: [
              "// 门面：仅做编排，领域逻辑下沉到 order/ 子模块",
              "import { OrderCreator } from './order/OrderCreator';",
              "import { OrderPricer } from './order/OrderPricer';",
              "import { OrderRepo } from './order/OrderRepo';",
              "",
              "export class OrderService {",
              "  constructor(",
              "    private readonly creator = new OrderCreator(),",
              "    private readonly pricer = new OrderPricer(),",
              "    private readonly repo = new OrderRepo(),",
              "  ) {}",
              "",
              "  async createOrder(input: CreateOrderInput) {",
              "    const quote = this.pricer.quote(input);",
              "    const order = await this.repo.save(input, quote);",
              "    await this.creator.afterCreated(order, input);",
              "    return order;",
              "  }",
              "}",
            ].join("\n"),
          },
          {
            fileName: "src/services/order/OrderPricer.ts",
            oldText: "",
            newText: [
              "import { calcDiscount, calcTax } from '../money';",
              "",
              "export interface PriceQuote {",
              "  price: number; tax: number; shipping: number; total: number;",
              "}",
              "",
              "export class OrderPricer {",
              "  quote(input: CreateOrderInput): PriceQuote {",
              "    const price = calcDiscount(input);",
              "    const tax = calcTax(price);",
              "    const shipping = input.weight > 5 ? 12 : 0;",
              "    return { price, tax, shipping, total: price + tax + shipping };",
              "  }",
              "}",
            ].join("\n"),
          },
        ],
        generatedAt: now,
      },
    };
  },
};

/**
 * 场景③ 前端重构助手：应用重构（高危写操作，触发 HITL 审批）
 * 审批通过后返回 ui_code_checkpoint 卡片（内嵌 VaCheckpointList）
 */
export const CodeRefactorApplyTool: HarnessTool = {
  name: "code_refactor_apply",
  description: "将重构预览真正写入仓库（高危写操作，触发人工安全审批），完成后生成检查点",
  parameters: Type.Object({
    target: Type.String({ description: "已生成过预览的目标模块" }),
  }),
  riskLevel: "high",
  requiresApproval: true,
  writesWorkspace: true,
  execute: async (ctx) => {
    const target = String(ctx.args.target || "OrderService");
    const now = Date.now();
    return {
      rendered: true,
      component: "ui_code_checkpoint",
      props: {
        target,
        checkpoints: [
          { id: "ck-1", label: "仓库初始状态", createdAt: now - 86_400_000, summary: "4 文件 · 上游同步" },
          { id: "ck-2", label: `重构前快照（${target} 单体）`, createdAt: now - 300_000, summary: "OrderService.ts 208 行内联逻辑" },
          { id: "ck-3", label: "重构已应用", createdAt: now, summary: "+234 / −208 · 3 新模块 · 全量测试通过", current: true },
        ],
      },
    };
  },
};

export const codeTools = [CodeRefactorPreviewTool, CodeRefactorApplyTool];
