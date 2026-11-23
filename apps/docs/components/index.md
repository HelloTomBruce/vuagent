<script setup>
import { components } from "../../../meta/components.mjs";

const cats = ["Agent-Ops", "Chat", "基础", "表单", "反馈", "图表", "Screens", "Blocks", "Illustrations", "动效"];
</script>

# 组件总览与分类导航

> Vuagent 包含 73 个专为 AI Agent 运行时操作层（Agent Ops）打造的强类型 Vue 3 组件。
> 每个组件遵循「**薄模板 + 独立样式 + 强类型 + composable 逻辑**」的单元规范，零多余运行时依赖。

---

## 🌟 组件分类精选（带实时效果展示）

为了让你更直观地体验各组件的交互质感，我们按照核心业务域细化拆分了交互演示专页：

| 分类专栏 | 核心价值 | 代表组件 | 快速直达 |
| :--- | :--- | :--- | :--- |
| **Agent-Ops 旗舰** | 任务计划追踪、高风险审批门、工具调用链、代码差异与上下文仪表 | `VaApprovalCard` · `VaAgentPlan` · `VaToolCallCard` · `VaContextWindow` · `VaCodeDiff` | [查看实际效果 ➔](/components/agent-ops) |
| **Chat 对话交互** | 思考链轮播加载、流式逐字打字机、消息操作栏与对话输入框 | `VaThinkingLoader` · `VaStreamAnswer` · `VaMessageActions` · `VaComposer` | [查看实际效果 ➔](/components/chat) |
| **基础与浮层原语** | 按钮变体、基于 `useFloating` 的气泡浮层、无障碍下拉选择与文字提示 | `VaButton` · `VaPopover` · `VaTooltip` · `VaSelect` · `VaDialog` | [查看实际效果 ➔](/components/overlays) |
| **反馈与图表可视化** | 零重型库依赖、纯手写 SVG 迷你趋势卡、时序折线图与 AI 智能建议 | `VaKpiChart` · `VaMetricChart` · `VaSmartRecommendation` | [查看实际效果 ➔](/components/charts) |

---

## 全量组件参数速查 (73+)

全部组件参数的机器可读版本见仓库根目录的 `llms-full.txt`。

<template v-for="cat in cats" :key="cat">
  <h2 :id="cat">{{ cat }}</h2>
  <section v-for="c in components.filter(x => x.category === cat)" :key="c.slug" class="comp-card">
    <h3>{{ c.title }}</h3>
    <p class="comp-slug">registry: <code>@vuagent/{{ c.slug }}</code> · 组件：<code v-for="name in c.components" :key="name">{{ name }} </code></p>
    <p>{{ c.desc }}</p>
    <table>
      <thead>
        <tr><th>Prop / 事件</th><th>类型</th><th>默认</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in c.props" :key="p.name">
          <td><code>{{ p.name }}</code></td>
          <td><code>{{ p.type }}</code></td>
          <td>{{ p.default }}</td>
          <td>{{ p.desc }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style>
.comp-card { border: 1px solid var(--vp-c-divider); border-radius: 10px; padding: 4px 20px 8px; margin: 14px 0; }
.comp-slug { font-size: 12px; color: var(--vp-c-text-3); }
.comp-slug code { font-size: 11.5px; }
</style>
