/** 插画三件的类型定义（VaVoiceOrb / VaAgentTeam / VaModelWheel） */

export type VoiceState = "idle" | "listening" | "speaking";

export interface VoiceOrbProps {
  state?: VoiceState;
  /** 直径 px（默认 96） */
  size?: number;
  /** 主色（默认 accent） */
  color?: string;
}

export interface AgentTeamProps {
  /** agent 名字列表（取首字母徽标） */
  agents: Array<{ id: string; name: string }>;
  /** 环直径 px（默认 180） */
  size?: number;
  /** 悬浮动画（默认 true） */
  floating?: boolean;
}

export interface ModelWheelProps {
  /** 模型名列表（取首字母徽标，环形排布） */
  models: Array<{ id: string; name: string }>;
  /** 直径 px（默认 200） */
  size?: number;
  /** 缓慢自转（默认 true） */
  spinning?: boolean;
  /** 中心文案 */
  centerLabel?: string;
}
