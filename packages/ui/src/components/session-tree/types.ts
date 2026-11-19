/** VaSessionTree 的类型定义（结构与协议 SessionMeta / WorkspaceInfo 保持一致） */

export interface TreeWorkspace {
  id: string;
  name: string;
  description?: string;
}

export interface TreeSession {
  id: string;
  /** 空串 = 未命名 */
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** 所属工作区（分组依据） */
  workspaceId?: string;
  /** agent 运行中（琥珀脉冲点） */
  running?: boolean;
  /** 有待审批（红点 + 徽标） */
  waitingApproval?: boolean;
  /** 已置顶（图钉标记；排序由宿主负责） */
  pinned?: boolean;
}

export interface SessionTreeProps {
  /** 全部工作区（平铺分组标题，按数组顺序展示） */
  workspaces: TreeWorkspace[];
  /** 全部非归档会话（按 workspaceId 归入对应分组） */
  sessions: TreeSession[];
  /** 已归档会话（收进底部「已归档」分区） */
  archived: TreeSession[];
  /** 当前会话所属工作区 id（仅用于分组高亮，不涉及切换） */
  currentWorkspaceId: string;
  /** 当前活跃会话 id */
  currentSessionId: string;
  disabled?: boolean;
  /** 新建工作区模式：input=行内输入框（默认）；picker=「＋」直接触发 createWorkspacePick（宿主弹原生目录选择框） */
  workspaceCreateMode?: "input" | "picker";
  /** 顶部常驻「＋ 新建会话」按钮（目标 = 当前工作区；无工作区时禁用） */
  newSession?: boolean;
  /** 显示会话搜索框（组件内按标题过滤） */
  searchable?: boolean;
  /** 工作区分组可折叠（chevron 切换，默认全部展开；默认 false 平铺） */
  collapsible?: boolean;
  /** 行操作按钮 hover/focus 时才显示（确认态除外）；默认 false 常驻 */
  hoverOps?: boolean;
  /**
   * 删除确认模式（会话/工作区删除）：
   * - "inline"（默认）：行内二次确认（3s 内再次点击，「确认?」文案）
   * - "none"：直接发 remove / removeWorkspace 事件，由宿主路由到 vaConfirm 等模态确认
   */
  confirmMode?: "inline" | "none";
}

export interface SessionTreeEvents {
  /** 新建工作区（input 模式：携带输入的名称，Enter 提交） */
  createWorkspace: [name: string];
  /** picker 模式：点击「＋ 新建工作区」立即触发（宿主弹原生选择框，无输入框） */
  createWorkspacePick: [];
  /** 点击会话行 → 切换会话 */
  selectSession: [id: string];
  /** 新建会话（在指定工作区下） */
  createSession: [workspaceId: string];
  /** 删除工作区（行内二次确认；其下会话回到未分组） */
  removeWorkspace: [id: string];
  /** 置顶/取消置顶会话（排序由宿主负责） */
  togglePin: [id: string];
  rename: [id: string, title: string];
  /** 归档（true）/ 恢复（false） */
  archive: [id: string, archived: boolean];
  /** 删除（行内二次确认） */
  remove: [id: string];
}
