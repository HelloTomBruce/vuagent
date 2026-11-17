/** VaDock 的类型定义：右侧面板停靠容器（≤2 分屏 + 全屏 + tab 条） */

import type { Component } from "vue";

export interface DockTab {
  id: string;
  /** 展示名（缺省回退 id） */
  label?: string;
  /** lucide 图标组件（宿主 markRaw 传入） */
  icon?: Component;
  /** 是否可关闭（默认 true） */
  closable?: boolean;
}

/** 单个分屏 pane 的受控状态 */
export interface DockPaneState {
  tabs: DockTab[];
  /** 当前激活 tab（空串 = 空面板） */
  activeId: string;
}

export interface DockProps {
  /** 1 个 = 单面板；2 个 = 分屏（≤2） */
  panes: DockPaneState[];
  /** 分屏分隔位置 0.2–0.8（受控；拖动中实时 emit resize） */
  ratio?: number;
  /** 全屏的 pane 下标；null = 非全屏 */
  fullscreenPane?: number | null;
  addDisabled?: boolean;
  splitDisabled?: boolean;
}

export interface DockEvents {
  /** 点击某 pane 的 tab */
  select: [paneIndex: number, tabId: string];
  /** 关闭某 pane 的 tab */
  close: [paneIndex: number, tabId: string];
  /** 点击某 pane 的「＋」（宿主弹出可添加面板菜单） */
  add: [paneIndex: number];
  /** 请求分屏 / 取消分屏 */
  split: [];
  unsplit: [];
  /** 请求某 pane 全屏；再次传 null 退出 */
  fullscreen: [paneIndex: number | null];
  /** 拖动分隔条（实时） */
  resize: [ratio: number];
  /** 折叠整个 Dock（宿主收起右侧栏） */
  collapse: [];
}
