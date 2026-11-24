import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/** 仿真仓库的重构 diff 集（3 文件，供 code_refactor_preview 返回） */
function buildDiffs() {
  return [
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
    {
      fileName: "src/services/order/OrderRepo.ts",
      oldText: "",
      newText: [
        "import { prisma } from '../../db';",
        "import type { PriceQuote } from './OrderPricer';",
        "",
        "export class OrderRepo {",
        "  async save(input: CreateOrderInput, quote: PriceQuote) {",
        "    return prisma.order.create({",
        "      data: {",
        "        userId: input.userId,",
        "        items: { create: input.items },",
        "        price: quote.price,",
        "        tax: quote.tax,",
        "        shipping: quote.shipping,",
        "        total: quote.total,",
        "      },",
        "    });",
        "  }",
        "}",
      ].join("\n"),
    },
  ];
}

/**
 * 场景③ 前端重构助手：生成重构预览（只读）
 * 返回 ui_code_change 卡片（VaFileTree + VaCodeDiff + VaChangeSummary，3 文件 diff）
 */
export const CodeRefactorPreviewTool: HarnessTool = {
  name: "code_refactor_preview",
  description: "对指定模块生成重构预览：变更文件树、逐文件代码 diff 与变更摘要（内置仿真仓库）。预览确认后可调用 code_run_tests 验证，再调用 code_refactor_apply 落盘。",
  parameters: Type.Object({
    target: Type.String({ description: "要重构的模块，例如 OrderService" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const target = String(ctx.args.target || "OrderService");
    const diffs = buildDiffs();
    return {
      rendered: true,
      component: "ui_code_change",
      props: {
        target,
        summary: {
          duration: 34_200,
          toolCalls: 9,
          files: [
            { path: "src/services/OrderService.ts", status: "M", additions: 18, deletions: 208 },
            { path: "src/services/order/OrderCreator.ts", status: "A", additions: 96, deletions: 0 },
            { path: "src/services/order/OrderPricer.ts", status: "A", additions: 16, deletions: 0 },
            { path: "src/services/order/OrderRepo.ts", status: "A", additions: 22, deletions: 0 },
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
        diffs,
        generatedAt: Date.now(),
      },
    };
  },
};

/**
 * 场景③ 前端重构助手：运行重构验证测试（只读）
 * 返回 ui_code_tests 卡片（VaTerminalLog ANSI 日志：首轮 2 失败 → 修复 → 重跑全绿）
 */
export const CodeRunTestsTool: HarnessTool = {
  name: "code_run_tests",
  description: "对重构后的模块运行验证测试套件，返回终端日志卡片（含失败用例与修复重跑过程）",
  parameters: Type.Object({
    target: Type.Optional(Type.String({ description: "目标模块，缺省为最近一次重构的模块" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const target = String(ctx.args.target || "OrderService");
    const G = "\u001b[32m";
    const R = "\u001b[31m";
    const Y = "\u001b[33m";
    const C = "\u001b[36m";
    const D = "\u001b[90m";
    const X = "\u001b[0m";
    return {
      rendered: true,
      component: "ui_code_tests",
      props: {
        title: `vitest ${target} — first run → fix → rerun`,
        verdict: "46 passed",
        lines: [
          `${D}$ vitest run services/order${X}`,
          `${C}▸ OrderCreator${X} 应创建订单并发事件 · 创建后应清空购物车 · 库存不足应抛 OUT_OF_STOCK`,
          `${R}✗ services/order/OrderPricer.test.ts > 满额运费应为 0${X}`,
          `  ${D}expected 12 to be 0 // 运费判断仍引用旧 input.weight 字段${X}`,
          `${R}✗ services/order/OrderRepo.test.ts > 保存订单应含价格快照${X}`,
          `  ${D}expected undefined to be Object({ price, tax, shipping, total })${X}`,
          `${Y}⏸ 2 failed | 44 passed (3.2s) → 自动修复：Pricer 读取 quote.weight / Repo 补快照字段${X}`,
          `${D}$ vitest run services/order --rerun${X}`,
          `${G}✓ services/order/OrderCreator.test.ts (3)${X}`,
          `${G}✓ services/order/OrderPricer.test.ts (4)${X}`,
          `${G}✓ services/order/OrderRepo.test.ts (5)${X}`,
          `${G}✓ services/order/OrderService.test.ts (34)${X}`,
          `${G}✔ 46 passed (2.8s)  Test Files 4 passed (4)${X}`,
          `${D}coverage: statements 91.4% / branches 84.2% — 均高于基线${X}`,
        ],
      },
    };
  },
};

/**
 * 场景③ 前端重构助手：应用重构（高危写操作，触发 HITL 审批）
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
          { id: "ck-3", label: "重构已应用（测试 46 通过）", createdAt: now, summary: "+234 / −208 · 3 新模块 · coverage 91.4%", current: true },
        ],
      },
    };
  },
};

export const codeTools = [CodeRefactorPreviewTool, CodeRunTestsTool, CodeRefactorApplyTool];
