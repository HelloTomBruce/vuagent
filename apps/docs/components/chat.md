<script setup lang="ts">
import { ref } from "vue";
import {
  VaThinkingLoader,
  VaStreamAnswer,
  VaMessageActions,
  VaComposer,
} from "@vuagent/ui";

const sampleAnswer = "Vue 3.5 引入了全新的响应式重构，内存占用降低了 56%，并在大型 SSR 场景下提升了 10% 的水合速度。同时推出了稳定的 useTemplateRef() 与 ReactivePropsDestructure 语法。";

const composerText = ref("");

function handleComposerSend(content: string) {
  alert(`触发发送: ${content}`);
  composerText.value = "";
}
</script>

# Chat 对话交互组件

> 专为现代 AI 对话界面量身定制的交互组件：从推理阶段的思考链动效、渐进流式打字渲染，到消息操作栏与多功能输入框。

---

## 1. VaThinkingLoader — 思考阶段轮播加载器

模型处于思考（Reasoning / Thinking）阶段时展示阶段性状态轮播与微动效，缓解用户的等待焦虑。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">思考中状态预览</div>
  <VaThinkingLoader
    :phases="['正在分析用户意图...', '检索相关知识库与 Schema...', '规划工具执行链路...']"
    :interval="2000"
    loop
  />
</div>

### 代码示例

```vue
<template>
  <VaThinkingLoader
    :phases="['正在分析意图...', '检索相关文档...', '生成最终方案...']"
    :interval="2000"
    loop
  />
</template>
```

---

## 2. VaStreamAnswer — 流式打字机效果

按照指定节奏将长文本以流式逐字输出，自带平滑的打字机光标动效。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">流式文本渲染预览</div>
  <VaStreamAnswer
    :source="sampleAnswer"
    :interval="40"
    auto-play
  />
</div>

### 代码示例

```vue
<template>
  <VaStreamAnswer
    :source="fullText"
    :interval="40"
    auto-play
  />
</template>
```

---

## 3. VaMessageActions — 消息操作栏

提供复制正文、重新生成回答、多版本切换以及点赞/点踩质量反馈。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">消息反馈操作条</div>
  <div style="padding: 12px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 8px;">
    <p style="margin: 0 0 12px 0;">这是助手的一条回复内容示例...</p>
    <VaMessageActions
      text="这是助手的一条回复内容示例..."
      :versions="2"
      @copy="() => alert('已复制到剪贴板')"
      @regenerate="() => alert('触发重新生成')"
    />
  </div>
</div>

---

## 4. VaComposer — 富交互对话输入框

集成输入、快捷指令、发送按钮及状态联动的对话输入组件。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">输入框效果预览</div>
  <VaComposer
    v-model="composerText"
    placeholder="输入您的业务需求，按 Enter 发送..."
    @send="handleComposerSend"
  />
</div>
