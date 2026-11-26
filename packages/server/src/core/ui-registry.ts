import type { UIComponentDefinition } from "@vuagent/protocol";
import { assertValidInteraction } from "@vuagent/protocol";
import type { HarnessTool } from "./types.js";

/**
 * 开放 UI 组件注册中心 (UIComponentRegistry)
 * 允许应用层 / 开发者针对特定场景自定义消息渲染组件，
 * 并将其安全、声明式地转化为大模型可见的 HarnessTool。
 */
export class UIComponentRegistry {
  private components = new Map<string, UIComponentDefinition>();

  /**
   * 注册自定义 UI 组件契约
   * TASK-089：声明了 interaction 的组件在注册期做定义期校验（如 L2 缺 resultSchema
   * 直接抛错），把契约错误拦截在定义期而非首次交互时。
   */
  register(def: UIComponentDefinition): this {
    if (def.interaction) {
      assertValidInteraction(def.name, def.interaction);
    }
    this.components.set(def.name, def);
    return this;
  }

  /**
   * 获取组件定义
   */
  get(name: string): UIComponentDefinition | undefined {
    return this.components.get(name);
  }

  /**
   * 列出所有已注册的 UI 组件
   */
  list(): UIComponentDefinition[] {
    return Array.from(this.components.values());
  }

  /**
   * 将 UI 组件转换为对应的 HarnessTool 实例
   * 执行时返回标准结构化组件渲染结果 { rendered: true, component: name, props: args }
   */
  toHarnessTools(): HarnessTool[] {
    return this.list().map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.schema,
      riskLevel: "low",
      requiresApproval: false,
      writesWorkspace: false,
      // TASK-089：interaction 透传进 HarnessTool 扩展字段——执行器据此识别
      // 声明组件并走信封摘要双层结果；未声明组件（无此键）行为逐字节不变。
      ...(def.interaction ? { interaction: def.interaction } : {}),
      execute: async (ctx) => {
        return {
          rendered: true,
          component: def.name,
          props: ctx.args,
        };
      },
    }));
  }
}
