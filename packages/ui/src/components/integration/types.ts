/** VaIntegrationPicker / VaIntegrationSettings 的类型定义 */

export interface IntegrationItem {
  id: string;
  name: string;
  description?: string;
  /** 已连接态 */
  connected?: boolean;
  /** 图标地址；缺省首字母色块 */
  icon?: string;
}

export interface IntegrationPickerProps {
  items: IntegrationItem[];
  /** 卡片网格最小宽度 px，默认 200 */
  minCardWidth?: number;
  /** 单列布局（设置页嵌内时用） */
  stacked?: boolean;
}

export interface IntegrationPickerEvents {
  /** 点击卡片：切换连接/断开 */
  toggle: [item: IntegrationItem];
  select: [item: IntegrationItem];
}

/* ---------- IntegrationSettings ---------- */

export interface IntegrationField {
  id: string;
  label: string;
  /** 值由宿主维护（v-model:values） */
  placeholder?: string;
  /** 密文输入（密码/API key） */
  secret?: boolean;
  required?: boolean;
  /** 校验错误文案（宿主侧校验后传入） */
  error?: string;
}

export interface IntegrationSettingsProps {
  name: string;
  description?: string;
  /** v-model:enabled 总开关 */
  enabled?: boolean;
  defaultEnabled?: boolean;
  fields?: IntegrationField[];
  /** v-model:values 表单值 */
  values?: Record<string, string>;
  defaultValues?: Record<string, string>;
  /** 保存中 */
  saving?: boolean;
  /** 已保存状态提示文案（保存成功后宿主置一个短文案） */
  savedLabel?: string;
}

export interface IntegrationSettingsEvents {
  "update:enabled": [v: boolean];
  "update:values": [v: Record<string, string>];
  /** 点击保存（携带当前 enabled + values） */
  save: [payload: { enabled: boolean; values: Record<string, string> }];
  /** 断开连接 */
  disconnect: [];
}
