/** VaDropzone 的类型定义 */

export type DropzoneFileStatus = "uploading" | "done" | "error";

export interface DropzoneFile {
  id: string;
  name: string;
  /** 字节数 */
  size: number;
  /** 上传进度 0-100；<100 且无 error 视为进行中 */
  progress?: number;
  status?: DropzoneFileStatus;
  /** 校验/上传错误文案 */
  error?: string;
}

export interface DropzoneProps {
  /** 受控文件列表（上传进度由宿主驱动更新） */
  files: DropzoneFile[];
  /** input accept 属性，如 ".csv,image/*" */
  accept?: string;
  /** 多选；默认 false */
  multiple?: boolean;
  /** 单文件大小上限 MB；超出拒绝并 emit reject */
  maxSizeMb?: number;
  /** 拖放区文案 */
  label?: string;
  /** 上传中禁用新选择 */
  busy?: boolean;
}

export interface DropzoneEvents {
  /** 用户添加了文件（已通过 accept/maxSize 前置校验的原始 File 对象） */
  add: [files: File[]];
  /** 移除列表项 */
  remove: [id: string];
  /** 被拒文件（超大小） */
  reject: [files: File[], reason: "too-large"];
}
