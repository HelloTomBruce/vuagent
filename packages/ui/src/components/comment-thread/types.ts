/** VaCommentThread 的类型定义 */

export interface CommentItem {
  id: string;
  /** 作者名 */
  author: string;
  /** 头像图片地址；缺省用 initials 首字母色块 */
  avatar?: string;
  /** 首字母色块文案，缺省取 author 首字符 */
  initials?: string;
  /** 身份标注，如 "Agent" / "工程师" */
  role?: string;
  /** 评论正文（保留换行） */
  text: string;
  /** 创建时间（ms 时间戳） */
  createdAt?: number;
  /** agent 起草待审：展示采纳/重写操作条，视觉区别于人发评论 */
  pending?: boolean;
}

export interface CommentThreadProps {
  comments: CommentItem[];
  /** 底部输入框占位文案 */
  placeholder?: string;
  /** 提交中（按钮转"发布中…"并禁用） */
  busy?: boolean;
  /** 显示底部输入框（纯只读线程可关）；默认 true */
  composer?: boolean;
  /** 线程最大高度 px，超出滚动（输入框固定在底部之外） */
  maxHeight?: number;
}

export interface CommentThreadEvents {
  /** 发布评论（携带输入文本，组件随后自动清空输入框） */
  submit: [text: string];
  /** 采纳 agent 草稿：宿主把 pending 置 false（或删除草稿并 append 正式评论） */
  adopt: [id: string];
  /** 要求 agent 重写草稿 */
  rewrite: [id: string];
  /** 丢弃草稿（宿主移除该条） */
  discard: [id: string];
}
