---
layout: home

hero:
  name: Vuagent
  text: Vue 生态 Agent 运行时与操作层套件
  tagline: 为生产级 Vue 应用打造：快速嵌入现有项目、注册项目专属工具与 UI、解耦对接任意 Harness、内置成熟稳定的工业级服务端。
  actions:
    - theme: brand
      text: 产品定位与理念
      link: /guide/overview
    - theme: alt
      text: 快速接入 Vue 项目
      link: /guide/getting-started
    - theme: alt
      text: 浏览组件总览
      link: /components/

features:
  - title: ⚡ 深度融入现有 Vue 项目
    details: 不止是聊天框！通过 VaAgentChat 与 useAgentChat 零心智接入，支持无缝挂载项目特有的业务工具（Tools）与专属 UI 卡片，实现特定业务逻辑闭环。
  - title: 🔌 协议优先 · 对接任意 Harness
    details: 基于 @vuagent/protocol 单一事实契约（18 种 SSE 事件流）。只要满足协议，你的 Web 界面可自由对接 Python、Go、Java 等任何自研或开源 Agent 后端。
  - title: 🛡️ 工业级开箱即用 Harness Server
    details: 内置成熟自研的 @vuagent/server：执行与 HTTP 连接彻底解耦、断网/切页面自动重连、真·HITL 协程挂起审批、Token 预算控制与崩溃自愈。
  - title: 🎨 73+ 运行时 Agent-Ops 组件
    details: 计划（Plan）、审批（Approval）、工具流（Tool Call）、上下文仪表（Context）、代码差异（Diff）与收件箱。薄模板、独立样式、零多余依赖。
  - title: 📦 灵活双分发通道
    details: 支持 npm 整包引入，亦支持 shadcn-vue 式单文件直接拷贝到宿主源码中，样式令牌一键换肤，代码完全由你掌控。
  - title: 🤖 AI 原生友好 (llms.txt)
    details: 内置针对 Cursor / Claude Code 等 AI 编程智能体的 llms.txt 与 llms-full.txt，便于 AI 工具自动检索能力并高效生成代码。
---

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #3b82f6 30%, #10b981);
}
</style>
