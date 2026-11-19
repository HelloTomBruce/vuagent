# Vuagent Logo —「V 轨迹」

Vuagent 的品牌标识。一条 **Agent 执行轨迹**构成字母 **V**(Vue · Vuagent):

| 部件 | 语义 | 对应组件域 |
|---|---|---|
| 左笔画 · 墨色虚线 | 计划(尚未发生、正在提议的步骤) | `VaAgentPlan` |
| 顶点 · 橙色圆环 | 审批门(危险操作前等待人工放行) | `VaApprovalCard` |
| 右笔画 · 橙色实线 | 执行(越过审批门,提案成为事实) | `VaTrajectory` |
| 右上端点 · 橙色实心点 | 完成(交付结果) | — |

颜色全部来自 `@vuagent/ui` 的 `--va-*` 设计令牌:烧橙 `#C2410C`(`--va-accent`)、墨 `#1A1917`(`--va-ink`)、纸 `#F7F6F2`(`--va-bg`)、夜 `#141311`(dark `--va-bg`)。

## 资产清单

| 文件 | 用途 |
|---|---|
| `vuagent-mark.svg` | 主标(透明底,亮色场景) |
| `vuagent-mark-dark.svg` | 主标暗色变体(墨色底上用) |
| `vuagent-badge.svg` | 圆角瓷砖徽章(头像 / Social Preview) |
| `vuagent-badge-dark.svg` | 徽章暗色变体 |
| `vuagent-favicon.svg` | favicon 简化版(实线笔顺,16px 可读) |
| `vuagent-lockup.svg` | 横版组合「标 + vuagent」(README / 文档头) |
| `vuagent-lockup-dark.svg` | 横版组合暗色变体 |
| `badge-512.png` | 徽章 512px 位图(GitHub Social Preview 直接上传) |
| `favicon-32.png` | favicon PNG 回退 |
| `mark-512.png` | 主标 512px 位图 |
| `logo-showcase.html` | 品牌规范页(概念解析 / 缩放测试 / 接入代码 / 使用守则) |

## 接入示例

**README 头部(自动适配深浅色):**

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./logo/vuagent-lockup-dark.svg">
  <img src="./logo/vuagent-lockup.svg" alt="Vuagent" width="420">
</picture>
```

**VitePress 文档站:**

```ts
// apps/docs/.vitepress/config.ts
themeConfig: {
  logo: { light: "/logo/vuagent-mark.svg", dark: "/logo/vuagent-mark-dark.svg" },
}
```

**Favicon:**

```html
<link rel="icon" type="image/svg+xml" href="/logo/vuagent-favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/logo/favicon-32.png">
```

## 使用守则(摘要)

- ✓ 四部件完整使用;净空区 ≥ 1/4 标识高度;主标最小 24px,favicon 版最小 16px
- ✓ 只用官方两套配色(纸底亮色 / 墨底暗色);动效仅整段描画并尊重 `prefers-reduced-motion`
- ✗ 不旋转/倾斜/加投影;不改虚线为实线;不填充审批环;不拉伸变形;不用渐变霓虹色

完整规范用浏览器打开 `logo-showcase.html` 查看。
