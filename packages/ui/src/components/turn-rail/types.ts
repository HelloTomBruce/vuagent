/** 右侧轮次跳转轨上的一枚标记（一条 = 一个可跳转锚点） */
export interface TurnRailItem {
  /** 轮次 id，需与滚动容器内锚点元素上的属性（默认 data-turn-id）取值一致 */
  id: string;
  /** 悬停/聚焦时预览卡里的文案（缺省回退为「第 N 轮」） */
  label?: string;
  /** 角色：user 实心点（提问） / assistant 空心点（回复），缺省 user */
  role?: "user" | "assistant";
  /** 状态：streaming 呼吸脉冲；error 危险色；done/缺省为常态 */
  status?: "streaming" | "done" | "error";
}

export interface TurnRailProps {
  /** 轮次标记（顺序即对话顺序，与容器内锚点从上到下一致） */
  items: TurnRailItem[];
  /** 滚动容器元素；传入才启用点击跳转与滚动跟随（SSR / 未挂载可省略） */
  container?: HTMLElement | null;
  /** 锚点属性名，默认 data-turn-id（取值须等于 item.id） */
  anchorAttr?: string;
  /** 跳转后锚点距容器顶部的留白（px），默认 16 */
  offset?: number;
  /** 轮次数 ≤ 该值时自动隐藏（0 = 始终显示），默认 1 */
  minItems?: number;
  /** 悬停/聚焦预览卡，默认开启 */
  preview?: boolean;
  /** 悬浮定位（absolute 靠右垂直居中，父级需 position: relative），默认开启 */
  floating?: boolean;
  /** 受控当前轮次 id（不传则由滚动位置自算） */
  activeId?: string;
  /** 无障碍名称 */
  ariaLabel?: string;
}

export interface TurnRailEvents {
  /** 点击/键盘选中某轮（父级一般无需处理，滚动定位已由组件完成） */
  (e: "select", id: string, index: number): void;
  /** 当前轮次变化（滚动跟随或点击都会触发） */
  (e: "update:activeId", id: string): void;
}
