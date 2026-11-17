/** VaEmptyHero 的类型定义：空会话时的中央引导（选工作区开会话 / 新建工作区） */

export interface HeroWorkspace {
  id: string;
  name: string;
  /** 目录路径（卡片副标题） */
  path?: string;
}

export interface EmptyHeroProps {
  workspaces?: HeroWorkspace[];
  /** 新建工作区进行中（禁用卡片） */
  creating?: boolean;
  title?: string;
  description?: string;
}

export interface EmptyHeroEvents {
  /** 点击虚线「新建工作区」卡（宿主弹原生选择框） */
  createWorkspace: [];
  /** 点击某工作区卡 → 在其下创建新会话 */
  createSession: [workspaceId: string];
}
