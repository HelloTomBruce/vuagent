import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  // GitHub Pages 子路径部署
  base: "/vuagent/",
  title: "Vuagent",
  description: "Vue 生态第一个 Agent Ops 组件库：计划 / 审批 / 工具调用 / 上下文 / 收件箱",
  themeConfig: {
    siteTitle: "Vuagent",
    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "组件", link: "/components/" },
    ],
    sidebar: [
      {
        text: "指南",
        items: [
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "主题化", link: "/guide/theming" },
        ],
      },
      { text: "组件", items: [{ text: "组件总览", link: "/components/" }] },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/HelloTomBruce/vuagent" }],
  },
});
