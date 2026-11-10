<script setup>
import { components } from "../../../meta/components.mjs";

const cats = ["Agent-Ops", "Chat", "基础", "表单", "反馈", "动效"];
</script>

# 组件总览

全部 {{ components.length }} 个组件目录，按四件套组织（薄模板 + 独立样式 + 强类型 + composable）。
props 的机器可读版本见仓库根目录的 `llms-full.txt`。

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
