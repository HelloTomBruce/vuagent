/** VaProfileMenu 的类型定义 */

export interface ProfileMenuItem {
  id: string;
  label: string;
  /** 危险操作（如退出登录，红色） */
  danger?: boolean;
  disabled?: boolean;
}

export interface ProfileMenuProps {
  name: string;
  email?: string;
  /** 头像图片地址；缺省用首字母色块 */
  avatar?: string;
  initials?: string;
  items?: ProfileMenuItem[];
  /** 右上角未读徽标数 */
  badge?: number;
}

export interface ProfileMenuEvents {
  select: [item: ProfileMenuItem];
}
