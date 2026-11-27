import { defineConfig, postcssIsolateStyles } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  base: "/vuagent/",
  title: "Vuagent",
  description: "Vue 生态 Agent 运行时与操作层套件：业务快速嵌入、自定义工具/UI、协议解耦对接、工业级 Harness 服务端",
  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
  ],
  vite: {
    server: {
      // 专用 dev 端口（避免默认 5173 与其他项目冲突）；strictPort：被占直接报错而非悄悄漂移
      port: 6970,
      strictPort: true,
    },
    css: {
      postcss: {
        plugins: [
          // 根因修复：VitePress 文档排版样式（.vp-doc h4/p/ol/code…，特异性 0,1,1）
          // 会泄漏进 markdown 页内直接渲染的组件，压过组件自身 BEM 样式（0,1,0），
          // 导致 VaApprovalCard 标题 h4 被加上 margin: 24px / font-size: 18px 等而错位。
          // 给 vp-doc.css 全部选择器追加 :not(:where(.vp-raw, .vp-raw *)) 豁免前缀，
          // 演示容器标注 .vp-raw 后，组件不再被文档排版污染（base.css 的 reset 保留，无害）。
          postcssIsolateStyles({ includeFiles: [/vp-doc\.css/] }),
        ],
      },
    },
  },
  themeConfig: {
    siteTitle: "Vuagent",
    nav: [
      { text: "产品定位", link: "/guide/overview" },
      { text: "接入指南", link: "/guide/getting-started" },
      { text: "开放协议 (Protocol)", link: "/protocol/overview" },
      { text: "官方服务端 (Server)", link: "/server/overview" },
      { text: "组件库", link: "/components/" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "核心理念",
          items: [
            { text: "产品定位与架构理念", link: "/guide/overview" },
            { text: "可交互组件（L0–L3）", link: "/guide/interactive-components" },
            { text: "快速接入现有 Vue 项目", link: "/guide/getting-started" },
            { text: "接入项目特有工具与自定义 UI", link: "/guide/custom-tools-and-ui" },
            { text: "自定义交互组件（interaction 契约）", link: "/guide/custom-interactive-components" },
            { text: "流式消费 Hooks（自建数据域）", link: "/guide/streaming-hooks" },
            { text: "主题化与样式定制", link: "/guide/theming" },
            { text: "CLI 一条命令跑起来", link: "/guide/cli" },
            { text: "内置供应商与请求头规则", link: "/guide/providers" },
          ],
        },
      ],
      "/protocol/": [
        {
          text: "开放契约层",
          items: [
            { text: "协议总览与契约设计", link: "/protocol/overview" },
            { text: "18 个流式事件全集", link: "/protocol/events" },
            { text: "对接自定义后端 (Python/Go/Java)", link: "/protocol/custom-backend" },
            { text: "HITL 动作与审批回调", link: "/protocol/actions" },
          ],
        },
      ],
      "/server/": [
        {
          text: "官方 Harness Server",
          items: [
            { text: "服务端总体架构", link: "/server/overview" },
            { text: "执行枢纽与断线重连", link: "/server/execution-hub" },
            { text: "权限模型与 HITL 协程挂起", link: "/server/permissions-and-hitl" },
            { text: "Token 预算与上下文治理", link: "/server/context-management" },
            { text: "部署与生产运维", link: "/server/deployment" },
          ],
        },
      ],
      "/components/": [
        {
          text: "组件参考",
          items: [
            { text: "组件总览与分类", link: "/components/" },
            { text: "Agent-Ops 旗舰组件", link: "/components/agent-ops" },
            { text: "Chat 对话交互组件", link: "/components/chat" },
            { text: "基础与浮层组件", link: "/components/overlays" },
            { text: "表单与集成组件", link: "/components/forms" },
            { text: "反馈与图表可视化", link: "/components/charts" },
            { text: "Screens 与工作区块", link: "/components/screens" },
            { text: "动效与插画组件", link: "/components/effects" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/HelloTomBruce/vuagent" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024-present Vuagent Team",
    },
  },
});
