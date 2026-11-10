/** VaEmailDraft 的类型定义 */

export interface ToneOption {
  value: string;
  label: string;
}

export interface EmailDraftProps {
  /** 收件人（受控） */
  to?: string;
  subject?: string;
  body?: string;
  /** 受控三字段：配合 update 事件实现 v-model:to / subject / body */
  /** agent 起草中：字段区显示骨架 */
  drafting?: boolean;
  /** 发送中（按钮禁用 + 文案） */
  sending?: boolean;
  /** 语气选项；提供后显示语气 chips */
  tones?: ToneOption[];
  /** 当前语气 value */
  tone?: string;
  /** 收件人/主题校验错误文案（宿主校验；空时发送按钮可用） */
  error?: string;
}

export interface EmailDraftEvents {
  "update:to": [v: string];
  "update:subject": [v: string];
  "update:body": [v: string];
  "update:tone": [v: string];
  /** 点击发送（携带完整草稿） */
  send: [draft: { to: string; subject: string; body: string; tone?: string }];
  /** 要求 agent 重新起草 */
  regenerate: [];
}
