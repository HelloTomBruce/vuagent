/** VaModelPicker 的类型定义 */

export interface ModelItem {
  id: string;
  name: string;
  /** 右侧小标签，如 "推荐" / "快" */
  tag?: string;
}

export interface ModelPickerProps {
  models?: ModelItem[];
  /** 菜单对齐方向 */
  align?: "left" | "right";
  ariaLabel?: string;
}

export interface ModelPickerEvents {
  "update:selected": [id: string];
}
