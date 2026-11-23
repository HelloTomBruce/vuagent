export interface UserAttachment {
  /** 附件类型：图片或通用文件 */
  kind: "image" | "file";
  /** 附件文件名 */
  name: string;
  /** 文件大小（字节） */
  size?: number;
  /** 图片 base64 / data URL，用于即时预览 */
  dataUrl?: string;
  /** 外部链接地址 */
  url?: string;
}

export interface UserBubbleProps {
  /** 用户提问正文 */
  content?: string;
  /** 多模态附件列表（图片、文本、文档） */
  attachments?: UserAttachment[];
  /** 用户头像或名称缩写 */
  avatar?: string;
  /** 发送时间戳或可读时间文本 */
  time?: string | number;
}
