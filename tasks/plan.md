# Implementation Plan: 基础通用 Overlay 组件族（Select / Dialog / Popover / Confirm / Dropdown / Tooltip）

## Overview

为 `@vuagent/ui` 补齐通用浮层组件族。现状盘点：库内已有 combobox（输入式选择）、filter-menu、command-menu（已用 Teleport）、toaster / notification-stack（全局通知 store 模式），但缺一组**基础通用**的 overlay 原语与组件——下拉选择、模态弹窗、popover、命令式 confirm、动作菜单、tooltip。本次按「原语先行、垂直切片」交付 6 个新组件 + 1 个集成收尾任务。

## Architecture Decisions

- **零运行时依赖**：peerDependencies 仅 `vue`。不引入 floating-ui，定位引擎手写轻量 `useFloating`（getBoundingClientRect + scroll/resize 监听 + flip/shift 防溢出），与 registry「单文件拷贝、自包含分发」约束一致（共享 composable 构建期自动内联）。
- **目录约定**（与现有 60+ 组件一致）：`VaXxx.vue`（薄模板）+ `VaXxx.css`（token 驱动样式）+ `types.ts` + `useXxx.ts`（逻辑）+ `index.ts`（出口）；样式只用 `styles/tokens.css` 的 Calm palette 变量，暗色经 `[data-theme="dark"]` 自动生效。
- **命令式 API 沿用 toaster 模式**：`VaConfirm` 复用 toaster 的 reactive store 模式（`vaConfirm({...}) → Promise<boolean>` + 宿主 `<VaConfirmHost />`），保持库内命令式 API 形态统一。
- **组件间依赖声明**：Select/Dropdown/Tooltip 依赖 popover 目录时，在 `meta/components.mjs` 的 deps 声明，registry 生成器自动写入 `registryDependencies`。
- **可访问性基线**：dialog → `role="dialog"` + `aria-modal` + 焦点陷阱 + 初始聚焦；select → `role="listbox"`/`option` + 完整键盘导航；dropdown → `role="menu"`/`menuitem`；tooltip → `role="tooltip"` + `aria-describedby`；confirm → `role="alertdialog"`（参照 approval-card 既有实现）。
- **测试形态**：沿用 `packages/ui/tests/*.ssr.test.ts`（@vue/server-renderer SSR 冒烟 + 关键 DOM/ARIA 断言）+ vitest 逻辑单测。

## Task List

### Phase 1: Foundation（原语，可并行）
- [x] **TASK-030** VaPopover + useFloating 浮层原语（P0）
- [ ] **TASK-031** VaDialog 模态弹窗（P0，不依赖 030，可并行）

### Checkpoint: Foundation
- ui 包 typecheck + test 全绿；`pnpm registry` 与 `registry:check` 通过

### Phase 2: 垂直切片（每片 = 组件 + 测试 + meta 登记）
- [ ] **TASK-032** VaSelect 下拉选择框（P0，dep 030）
- [ ] **TASK-033** VaConfirm 命令式确认框（P1，dep 031）
- [ ] **TASK-034** VaDropdown 动作下拉菜单（P1，dep 030）
- [x] **TASK-035** VaTooltip 文字提示（P1，dep 030）

### Checkpoint: Core
- 全仓 typecheck + 测试全绿；registry 自包含断言通过

### Phase 3: 集成收尾
- [ ] **TASK-036** docs/llms/registry 集成与总验收（P2，dep 030–035）

> 任务跟踪在 DSH workspace task board（TASK-030 ~ TASK-036）；本文件只作索引与架构记录。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 手写定位引擎边界 case（滚动容器嵌套、iframe、缩放） | Med | v1 只承诺 window 视口 + flip/shift；监听 capture 阶段的 scroll/resize；复杂场景文档标注后续可换 floating-ui |
| 焦点陷阱与页面既有焦点管理冲突 | Med | 参照 approval-card 的 alertdialog 实现；关闭时恢复触发前焦点；堆叠 dialog 用栈管理 |
| registry 自包含断言失败（跨目录 import 未声明） | Low | 共享逻辑放组件目录内 use 文件；跨组件依赖在 meta deps 显式声明 |
| 与 combobox/filter-menu 功能重叠引发定位困惑 | Low | 文档明确分工：combobox=可输入创建，select=纯选择；filter-menu=多组过滤，dropdown=动作菜单 |

## Open Questions

- Tooltip 是否随本批交付（P1，规模小，建议带上）；VaAlert 内联提醒条不在本批（toaster/notification-stack 已覆盖通知面），如需要可后续单开。
