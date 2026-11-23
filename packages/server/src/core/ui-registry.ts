import type { UIComponentDefinition } from "@vuagent/protocol";
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
   */
  register(def: UIComponentDefinition): this {
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
