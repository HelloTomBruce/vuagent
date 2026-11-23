/** VaComposer 的类型定义 */

export interface ComposerProps {
  placeholder?: string;
  disabled?: boolean;
  /** agent 运行中：禁发并隐藏发送钮 */
  busy?: boolean;
  /** 输入区最大高度 px（超过后内部滚动） */
  maxHeight?: number;
  /** 输入为空时也允许发送 */
  allowEmpty?: boolean;
  /** 模型候选（G21）；非空渲染模型 seat */
  models?: ComposerModelOption[];
  /** 受控当前模型 id */
  model?: string;
  /** 权限预设（G22）；非空渲染权限 seat */
  permissions?: ComposerPermissionOption[];
  /** 受控当前权限 id */
  permission?: string;
  /** 显示附件入口（回形针 / 拖拽 / 粘贴，G23） */
  attachable?: boolean;
  /** 附件上传中（paperclip 禁点） */
  uploading?: boolean;
  /** 待发送附件 rail */
  attachments?: ComposerAttachment[];
  /** 可高亮的 @引用 路径白名单（不含 @ 前缀；命中者以背景色强化显示） */
  mentionPaths?: string[];
}

export interface ComposerEvents {
  "update:text": [text: string];
  send: [text: string];
  /** busy 时发送钮变为停止钮（agent 运行中断）；宿主接取消逻辑 */
  stop: [];
  "update:model": [id: string];
  "update:permission": [id: string];
  /** 移除待发送附件 */
  removeAttachment: [id: string];
  /** 回形针/拖拽/粘贴选中的文件（上传由宿主处理） */
  filesSelected: [files: File[]];
}

export interface ComposerModelOption {
  id: string;
  label: string;
  /** 次要说明（provider 等） */
  meta?: string;
  /** 所属供应商（例如 DEEPSEEK / OPENAI） */
  provider?: string;
  /** 底层模型标识（例如 deepseek-chat） */
  model?: string;
}

export interface ComposerPermissionOption {
  id: string;
  label: string;
  desc?: string;
}

export interface ComposerAttachment {
  id: string;
  name: string;
  /** 字节 */
  size?: number;
  kind: "image" | "file";
  /** 图片本地预览（objectURL） */
  previewUrl?: string;
}
