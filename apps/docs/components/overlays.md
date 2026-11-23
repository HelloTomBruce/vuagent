<script setup lang="ts">
import { ref } from "vue";
import {
  VaButton,
  VaPopover,
  VaTooltip,
  VaSelect,
} from "@vuagent/ui";

const selectValue = ref("vue");
const selectOptions = [
  { label: "Vue 3 (当前)", value: "vue" },
  { label: "React 19", value: "react" },
  { label: "Svelte 5", value: "svelte" },
];
</script>

# 基础与浮层组件 (Overlays)

> 提供开箱即用、无障碍友好、动效丝滑的基础交互原语。支持亮暗双主题，遵循 `--va-*` 设计令牌体系。

---

## 1. VaButton — 按钮原语

支持 `primary`、`secondary`、`outline`、`ghost`、`danger` 等多种变体与三种尺寸档位。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">不同形态按钮（可点击交互）</div>
  <div class="demo-row">
    <VaButton variant="primary">主要操作</VaButton>
    <VaButton variant="secondary">次要操作</VaButton>
    <VaButton variant="outline">边框按钮</VaButton>
    <VaButton variant="ghost">幽灵按钮</VaButton>
    <VaButton variant="danger">危险操作</VaButton>
    <VaButton variant="primary" disabled>禁用状态</VaButton>
  </div>
  
  <div class="demo-title" style="margin-top: 20px;">不同尺寸档位</div>
  <div class="demo-row">
    <VaButton variant="primary" size="sm">小号 (sm)</VaButton>
    <VaButton variant="primary" size="md">中号 (md 默认)</VaButton>
    <VaButton variant="primary" size="lg">大号 (lg)</VaButton>
  </div>
</div>

### 代码示例

```vue
<template>
  <VaButton variant="primary">主要操作</VaButton>
  <VaButton variant="secondary">次要操作</VaButton>
  <VaButton variant="danger">危险操作</VaButton>
</template>
```

---

## 2. VaPopover — 浮层原语

基于 `useFloating` 定位引擎，支持空间不足自动翻转、视口贴边保护以及点击外部自动关闭。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">浮层效果预览（点击按钮打开）</div>
  <VaPopover placement="bottom-start">
    <template #trigger="{ open }">
      <VaButton variant="secondary">{{ open ? "收起面板" : "点击打开浮层" }}</VaButton>
    </template>
    <div style="padding: 16px; width: 240px; background: var(--va-color-surface, #fff); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.12);">
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">气泡浮层标题</h4>
      <p style="margin: 0; font-size: 13px; color: var(--vp-c-text-2);">这里可以承载任何自定义 Vue 组件，例如筛选面板、快捷菜单等。</p>
    </div>
  </VaPopover>
</div>

---

## 3. VaTooltip — 文字提示

轻量无障碍的悬浮文字提示，hover 或键盘获得焦点时平滑淡入。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">文字提示预览（鼠标悬停查看效果）</div>
  <div class="demo-row">
    <VaTooltip content="点击将代码变更提交至暂存区" placement="top">
      <VaButton variant="outline">悬停此按钮 (Top)</VaButton>
    </VaTooltip>
    <VaTooltip content="当前使用的是 GPT-4o-mini 模型" placement="bottom">
      <VaButton variant="outline">悬停此按钮 (Bottom)</VaButton>
    </VaTooltip>
  </div>
</div>

---

## 4. VaSelect — 下拉选择器

具备完整的键盘无障碍导航（↑↓ 键选值、Enter 确认、Esc 关闭）、支持搜索与清空。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">下拉选择预览</div>
  <div style="width: 260px;">
    <VaSelect
      v-model="selectValue"
      :options="selectOptions"
      label="技术栈选型"
      searchable
    />
  </div>
</div>
