import type { Component } from "vue";

export interface SceneChip {
  label: string;
  /** 点击 chip 发送给模型的 prompt（点名工具，保证演示命中） */
  prompt: string;
  tone?: "default" | "action";
}

export interface SceneDef {
  id: string;
  label: string;
  /** 场景一句话定位（顶部 Tab 副标题 / 宿主面板 banner） */
  tagline: string;
  greeting: string;
  chips: SceneChip[];
  /** 场景宿主面板组件（左侧画布区） */
  host: Component;
}
