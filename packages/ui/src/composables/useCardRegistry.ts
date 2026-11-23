import { shallowRef, type Component } from "vue";

/**
 * 前端场景组件注册表 (CardComponentRegistry)
 * 允许业务方 / 开发者注册特定场景下的富组件（例如股票 K 线卡片、CRM 工单卡片等），
 * 供 CardRenderer 动态挂载并渲染大模型下发的组件数据。
 */
const customCardComponents = shallowRef<Map<string, Component>>(new Map());

/**
 * 注册自定义卡片组件
 * @param name 组件唯一标识（需与后端 UIComponentDefinition.name 一致）
 * @param component Vue 3 组件对象
 */
export function registerCardComponent(name: string, component: Component): void {
  const next = new Map(customCardComponents.value);
  next.set(name, component);
  customCardComponents.value = next;
}

/**
 * 注销自定义卡片组件
 */
export function unregisterCardComponent(name: string): boolean {
  if (!customCardComponents.value.has(name)) return false;
  const next = new Map(customCardComponents.value);
  const result = next.delete(name);
  customCardComponents.value = next;
  return result;
}

/**
 * 获取已注册的自定义卡片组件
 */
export function getCardComponent(name: string): Component | undefined {
  return customCardComponents.value.get(name);
}

/**
 * 清空所有已注册的自定义组件（主要用于测试沙箱重置）
 */
export function clearCardComponents(): void {
  customCardComponents.value = new Map();
}

/**
 * Composable 入口
 */
export function useCardRegistry() {
  return {
    components: customCardComponents,
    register: registerCardComponent,
    unregister: unregisterCardComponent,
    get: getCardComponent,
    clear: clearCardComponents,
  };
}
