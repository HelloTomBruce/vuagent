<script setup lang="ts">
import { ref } from "vue";
import {
  VaButton,
  VaPopover,
  VaTooltip,
  VaSelect,
  VaSegmentedControl,
  VaCombobox,
  VaDropdown,
  VaDialog,
  VaConfirmHost,
  vaConfirm,
  VaToaster,
  vaToaster,
  VaCommandMenu,
  VaFilterMenu,
  VaOtpInput,
  VaDropzone,
  VaProgressTracker,
  VaUsageMeter,
  VaNumberTicker,
  VaSkeleton,
  VaShimmerText,
  VaProfileMenu,
} from "@vuagent/ui";

/* ---------- 4. VaSelect ---------- */
const selectValue = ref("vue");
const selectOptions = [
  { label: "Vue 3 (当前)", value: "vue" },
  { label: "React 19", value: "react" },
  { label: "Svelte 5", value: "svelte" },
];

/* ---------- 5. VaSegmentedControl ---------- */
const segValue = ref("week");
const segOptions = [
  { value: "day", label: "今日" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "custom", label: "自定义", disabled: true },
];

/* ---------- 6. VaCombobox ---------- */
const comboValue = ref("gpt-4o");
const comboMsg = ref("当前模型：GPT-4o");
const comboOptions = [
  { value: "gpt-4o", label: "GPT-4o", hint: "综合最强" },
  { value: "claude-sonnet", label: "Claude 3.5 Sonnet", hint: "代码生成擅长" },
  { value: "deepseek-v3", label: "DeepSeek-V3", hint: "性价比之选" },
  { value: "qwen-max", label: "Qwen-Max", disabled: true },
];
function onComboSelect(option: { label: string }) {
  comboMsg.value = `已切换模型：${option.label}`;
}
function onComboCreate(value: string) {
  comboMsg.value = `已创建自定义模型：${value}`;
}

/* ---------- 7. VaDropdown ---------- */
const dropdownMsg = ref("点击菜单项后此处回显操作结果");
const docMenuItems = [
  { id: "rename", label: "重命名", icon: "✏️", shortcut: "F2" },
  { id: "duplicate", label: "创建副本", icon: "📄" },
  { id: "d-1", divider: true },
  {
    id: "share",
    label: "分享",
    group: "协作",
    children: [
      { id: "share-link", label: "复制只读链接", shortcut: "⌘L" },
      { id: "share-invite", label: "邮件邀请协作者" },
    ],
  },
  { id: "readonly", label: "只读模式", group: "协作", checked: true },
  { id: "d-2", divider: true },
  { id: "history", label: "历史版本", shortcut: "⌘H", disabled: true },
  { id: "delete", label: "删除文档", danger: true },
];
const themeMenuItems = ref([
  { id: "light", label: "浅色", checked: true },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
]);
function onDocMenuSelect(item: { label?: string }) {
  dropdownMsg.value = `已执行：${item.label ?? ""}`;
}
function onThemeSelect(item: { id: string }) {
  themeMenuItems.value = themeMenuItems.value.map((i) => ({
    ...i,
    checked: i.id === item.id,
  }));
}

/* ---------- 8. VaDialog ---------- */
const dialogOpen = ref(false);
const dialogMsg = ref("弹窗尚未打开");

/* ---------- 9. VaConfirmHost ---------- */
const confirmMsg = ref("点击上方按钮发起命令式确认");
async function confirmPublish() {
  const ok = await vaConfirm({
    title: "发布文章《组件设计规范 v2》？",
    description: "发布后所有订阅者将收到推送通知，文章内容仍可修改。",
    confirmText: "确认发布",
    icon: true,
  });
  confirmMsg.value = ok ? "✅ 文章已发布" : "已取消发布";
}
async function confirmDelete() {
  const ok = await vaConfirm({
    title: "删除项目 vuagent-playground？",
    description: "项目下的 12 篇文档、部署记录与成员授权将一并删除，且不可恢复。",
    confirmText: "确认删除",
    tone: "danger",
    icon: true,
  });
  confirmMsg.value = ok ? "🗑️ 项目已删除" : "已取消删除";
}
async function confirmTransfer() {
  const ok = await vaConfirm({
    title: "转移空间所有权给 @moli？",
    description: "转移后你将降级为管理员。请逐字输入空间名称 team-infra 以确认。",
    confirmText: "确认转移",
    tone: "warning",
    icon: true,
    requireText: "team-infra",
    checkboxLabel: "同时邮件通知全部 8 名成员",
  });
  const checked = vaConfirm.details?.checked ?? false;
  confirmMsg.value = ok
    ? `所有权已转移${checked ? "，已邮件通知全部成员" : "（未通知成员）"}`
    : "已取消转移";
}

/* ---------- 10. VaToaster ---------- */
function pushToast(
  kind: "info" | "success" | "warning" | "danger",
  title: string,
  description: string
) {
  vaToaster.add({ title, description, kind, duration: 4200 });
}

/* ---------- 11. VaCommandMenu ---------- */
const commandOpen = ref(false);
const commandMsg = ref("点击按钮或按 ⌘K 打开命令面板");
const commandItems = [
  { id: "new-doc", label: "新建文档", group: "操作", hint: "⌘N", keywords: "create 新建 创建 文档" },
  { id: "new-project", label: "新建项目", group: "操作", keywords: "project 新建 项目" },
  { id: "search-docs", label: "搜索文档", group: "导航", hint: "⌘F", keywords: "search 搜索 find" },
  { id: "open-settings", label: "打开偏好设置", group: "导航", keywords: "settings 设置 偏好" },
  { id: "switch-theme", label: "切换亮暗主题", group: "偏好", keywords: "theme 主题 亮色 暗色" },
  { id: "delete-project", label: "删除当前项目", group: "危险操作", danger: true, keywords: "delete 删除 remove" },
];
function onCommandSelect(item: { label: string }) {
  commandMsg.value = `已执行命令：${item.label}`;
  commandOpen.value = false;
}

/* ---------- 12. VaFilterMenu ---------- */
const filterGroups = [
  {
    id: "status",
    label: "运行状态",
    type: "checkbox",
    options: [
      { value: "running", label: "运行中" },
      { value: "done", label: "已完成" },
      { value: "failed", label: "失败" },
    ],
  },
  {
    id: "model",
    label: "模型",
    type: "radio",
    options: [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "claude", label: "Claude 3.5" },
      { value: "deepseek", label: "DeepSeek-V3" },
    ],
  },
];
function formatFilter(value: Record<string, string[] | string>): string {
  const parts: string[] = [];
  for (const [groupId, val] of Object.entries(value)) {
    const group = filterGroups.find((g) => g.id === groupId);
    if (!group) continue;
    const text = Array.isArray(val)
      ? val.map((v) => group.options.find((o) => o.value === v)?.label ?? v).join("、")
      : (group.options.find((o) => o.value === val)?.label ?? String(val));
    if (text) parts.push(`${group.label}：${text}`);
  }
  return parts.length ? parts.join("；") : "未选择任何条件";
}
const filterValue = ref<Record<string, string[] | string>>({ status: ["running"] });
const filterMsg = ref(formatFilter(filterValue.value));
function onFilterChange(value: Record<string, string[] | string>) {
  filterMsg.value = formatFilter(value);
}
function onFilterClear() {
  filterMsg.value = "已清空全部筛选条件";
}

/* ---------- 13. VaOtpInput ---------- */
const otpValue = ref("");
const otpMsg = ref("输入 6 位验证码，支持整段粘贴自动分发");
function onOtpComplete(v: string) {
  otpMsg.value = `✅ 验证码 ${v} 校验通过`;
}

/* ---------- 14. VaDropzone ---------- */
type DzFile = {
  id: string;
  name: string;
  size: number;
  progress?: number;
  status?: "uploading" | "done" | "error";
  error?: string;
};
const dzFiles = ref<DzFile[]>([
  { id: "dz-1", name: "训练集-2024Q4.csv", size: 812340, progress: 100, status: "done" },
  { id: "dz-2", name: "评测报告-v3.md", size: 20480, progress: 100, status: "done" },
]);
const dzMsg = ref("拖入文件或点击上传（单文件不超过 2MB）");
function handleDzAdd(files: File[]) {
  for (const file of files) {
    const id = `dz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    dzFiles.value.push({ id, name: file.name, size: file.size, progress: 0, status: "uploading" });
    setTimeout(() => updateDzProgress(id, 55), 500);
    setTimeout(() => updateDzProgress(id, 100), 1200);
  }
  dzMsg.value = `已接收 ${files.length} 个文件，模拟上传中…`;
}
function updateDzProgress(id: string, progress: number) {
  const target = dzFiles.value.find((f) => f.id === id);
  if (!target) return;
  target.progress = progress;
  target.status = progress >= 100 ? "done" : "uploading";
  if (progress >= 100) dzMsg.value = `「${target.name}」上传完成`;
}
function handleDzRemove(id: string) {
  dzFiles.value = dzFiles.value.filter((f) => f.id !== id);
  dzMsg.value = "已从列表移除该文件";
}
function handleDzReject(files: File[]) {
  dzMsg.value = `⛔ ${files.map((f) => f.name).join("、")} 超出 2MB 限制，已拒绝`;
}

/* ---------- 15. VaProgressTracker ---------- */
const trackerCurrent = ref(1);
const trackerSteps = [
  { label: "拉取代码" },
  { label: "安装依赖" },
  { label: "运行测试" },
  { label: "构建发布" },
];
function onTrackerSelect(index: number) {
  trackerCurrent.value = index;
}

/* ---------- 16. VaUsageMeter ---------- */
const usageSegments = [
  { label: "Fast tokens", used: 268000 },
  { label: "Slow tokens", used: 352000 },
];
const usageWarnSegments = [
  { label: "Fast tokens", used: 512000 },
  { label: "Slow tokens", used: 358000 },
];
const usageMsg = ref("上方用量 62%；下方用量 87%，已超过 80% 预警阈值");
function onUsageManage() {
  usageMsg.value = "已点击「管理额度」，此处可跳转计费页面";
}

/* ---------- 17. VaNumberTicker ---------- */
const tickerValue = ref(128640);
const revenueValue = ref(86420);
function bumpTicker() {
  tickerValue.value += 1357;
}

/* ---------- 18. VaSkeleton + VaShimmerText ---------- */
/* 纯展示，无本地状态 */

/* ---------- 19. VaProfileMenu ---------- */
const profileMsg = ref("点击头像打开账户菜单");
const profileItems = [
  { id: "settings", label: "个人设置" },
  { id: "notifications", label: "消息通知" },
  { id: "api-keys", label: "API 密钥" },
  { id: "logout", label: "退出登录", danger: true },
];
function onProfileSelect(item: { label: string }) {
  profileMsg.value = `已选择：${item.label}`;
}
</script>

# 基础与浮层组件 (Overlays)

> 提供开箱即用、无障碍友好、动效丝滑的基础交互原语。支持亮暗双主题，遵循 `--va-*` 设计令牌体系。

---

## 1. VaButton — 按钮原语

支持 `primary`、`secondary`、`outline`、`ghost`、`danger` 等多种变体与三种尺寸档位。

### 交互效果预览

<div class="demo-preview vp-raw">
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

<div class="demo-preview vp-raw">
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

<div class="demo-preview vp-raw">
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

<div class="demo-preview vp-raw">
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

---

## 5. VaSegmentedControl — 分段控件

分段单选：滑块指示器平滑滑动到选中段，支持 ←→ 键盘切换与禁用项。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">统计时间范围切换（观察滑块滑动动效）</div>
  <VaSegmentedControl v-model="segValue" :options="segOptions" ariaLabel="统计时间范围" />
  <div class="demo-title" style="margin-top: 20px;">等分撑满 + 小号尺寸（与上方联动）</div>
  <VaSegmentedControl v-model="segValue" :options="segOptions" size="sm" fullWidth ariaLabel="统计时间范围（小号）" />
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">当前筛选：{{ segOptions.find((o) => o.value === segValue)?.label ?? segValue }}</p>
</div>

---

## 6. VaCombobox — 可搜索下拉组合框

输入即过滤，↑↓ 循环高亮、Enter 选中；开启 `creatable` 后可把输入内容创建为新值。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">模型选择（输入过滤，输入新名称回车即可创建）</div>
  <div style="width: 320px;">
    <VaCombobox
      v-model="comboValue"
      :options="comboOptions"
      creatable
      label="选择模型"
      placeholder="搜索模型或输入新名称…"
      emptyLabel="无匹配模型，回车即可创建"
      @select="onComboSelect"
      @create="onComboCreate"
    />
  </div>
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ comboMsg }}</p>
</div>

---

## 7. VaDropdown — 下拉菜单

动作下拉菜单：分组标题、分隔线、快捷键提示、danger 红字项与一层子菜单，完整键盘导航，`keepOpenOnSelect` 适配连续切换场景。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">文档操作菜单（分组 / 分隔线 / 子菜单 / 危险项）</div>
  <div class="demo-row">
    <VaDropdown :items="docMenuItems" triggerLabel="文档操作" @select="onDocMenuSelect" />
    <VaDropdown :items="themeMenuItems" keepOpenOnSelect placement="bottom-start" ariaLabel="主题切换" @select="onThemeSelect" />
  </div>
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ dropdownMsg }}（右侧三点菜单选中后保持打开，用于切换对勾）</p>
</div>

---

## 8. VaDialog — 模态对话框

模态弹窗原语：焦点陷阱、Esc / 遮罩关闭、堆叠栈管理。受控用法：触发按钮 + 本地 `open` 状态。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">偏好设置弹窗（打开后 Tab 焦点循环，Esc / 遮罩可关闭）</div>
  <div class="demo-row">
    <VaButton variant="primary" @click="dialogOpen = true">打开偏好设置</VaButton>
    <span style="font-size: 13px; color: var(--vp-c-text-2);">{{ dialogMsg }}</span>
  </div>
  <VaDialog v-model:open="dialogOpen" title="偏好设置" description="调整编辑器与通知行为，保存后立即生效。" size="sm">
    <div style="display: flex; flex-direction: column; gap: 12px; font-size: 14px;">
      <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" checked /> 自动保存草稿</label>
      <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" /> 构建完成后邮件通知我</label>
      <label style="display: flex; align-items: center; gap: 8px;"><input type="checkbox" checked /> 折叠已完成的计划步骤</label>
    </div>
    <template #footer="{ close }">
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <VaButton variant="ghost" @click="close()">取消</VaButton>
        <VaButton variant="primary" @click="dialogMsg = '偏好设置已保存'; close()">保存设置</VaButton>
      </div>
    </template>
  </VaDialog>
</div>

---

## 9. VaConfirmHost — 确认弹窗宿主

页面挂载一次 `VaConfirmHost`，任意位置 `await vaConfirm(options)` 即可弹出确认框（Promise 返回布尔值）；`danger` 语气初始聚焦取消按钮，`requireText` 需逐字输入才能确认。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">三种确认语气（普通 / 危险 / 手输确认）</div>
  <div class="demo-row">
    <VaButton variant="secondary" @click="confirmPublish">发布文章</VaButton>
    <VaButton variant="danger" @click="confirmDelete">删除项目（危险确认）</VaButton>
    <VaButton variant="outline" @click="confirmTransfer">转移所有权（手输确认）</VaButton>
  </div>
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ confirmMsg }}</p>
  <VaConfirmHost />
</div>

---

## 10. VaToaster — Toast 通知栈

宿主渲染一次，任意位置调用 `vaToaster.add({...})` 发通知：自动消失、可手动关闭，堆叠于右下角。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">四种语气通知（点击按钮在右下角弹出）</div>
  <div class="demo-row">
    <VaButton variant="secondary" @click="pushToast('success', '部署成功', 'vuagent-docs 已发布至生产环境')">成功通知</VaButton>
    <VaButton variant="secondary" @click="pushToast('info', '收到新评论', '张三评论了《组件设计规范》')">信息通知</VaButton>
    <VaButton variant="secondary" @click="pushToast('warning', '额度预警', '本月 tokens 已消耗 87%，请关注用量')">警告通知</VaButton>
    <VaButton variant="danger" @click="pushToast('danger', '构建失败', 'pnpm test 存在 2 个失败用例')">错误通知</VaButton>
  </div>
  <VaToaster position="bottom-right" />
</div>

---

## 11. VaCommandMenu — 命令面板

⌘K 命令面板：子串过滤、分组渲染、↑↓ 循环高亮、Enter 选中；`v-model:open` 受控开关，也可由外部状态打开。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">工作台命令面板（输入过滤，键盘或点击选中）</div>
  <div class="demo-row">
    <VaCommandMenu
      v-model:open="commandOpen"
      :commands="commandItems"
      triggerLabel="打开命令面板"
      hotkey="⌘K"
      placeholder="搜索命令…"
      @select="onCommandSelect"
    />
    <VaButton variant="outline" @click="commandOpen = true">从外部打开面板</VaButton>
  </div>
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ commandMsg }}</p>
</div>

---

## 12. VaFilterMenu — 筛选菜单

checkbox 多选组 + radio 单选组，触发按钮带激活计数徽章，面板内可一键清除全部。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">运行记录筛选（已预选「运行中」，徽标计数随勾选变化）</div>
  <div class="demo-row">
    <VaFilterMenu
      v-model="filterValue"
      :groups="filterGroups"
      triggerLabel="筛选"
      @update:modelValue="onFilterChange"
      @clear="onFilterClear"
    />
  </div>
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ filterMsg }}</p>
</div>

---

## 13. VaOtpInput — 验证码输入

分格输入：自动跳格与选中、退格回退、方向键移动、整段粘贴自动分发，填满触发 `complete`。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">两步验证登录（试试直接粘贴 6 位数字）</div>
  <VaOtpInput v-model="otpValue" :length="6" label="请输入 6 位验证码" @complete="onOtpComplete" />
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ otpMsg }}</p>
</div>

---

## 14. VaDropzone — 拖拽上传区

受控文件列表由宿主驱动：拖入高亮、点击/键盘选择、大小校验拒绝，列表项带进度条与移除按钮。演示中上传进度由宿主模拟推进。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">数据集上传（拖入或点击选择，超 2MB 会被拒绝）</div>
  <VaDropzone
    :files="dzFiles"
    accept=".csv,.json,.md"
    multiple
    :maxSizeMb="2"
    label="拖入文件到此处，或点击选择（支持 .csv / .json / .md）"
    @add="handleDzAdd"
    @remove="handleDzRemove"
    @reject="handleDzReject"
  />
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ dzMsg }}</p>
</div>

---

## 15. VaProgressTracker — 进度追踪

done / current / pending / error 四态节点 + 完成段连线填充；点击节点可跳转（`select` 事件携带下标）。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">发布流水线（点击任意节点跳转到该阶段）</div>
  <VaProgressTracker :steps="trackerSteps" :current="trackerCurrent" @select="onTrackerSelect" />
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">
    当前阶段：{{ trackerSteps[trackerCurrent]?.label }}（第 {{ trackerCurrent + 1 }} / {{ trackerSteps.length }} 步）
  </p>
</div>

---

## 16. VaUsageMeter — 用量仪表

多段堆叠用量条 + 图例 + 限额；占比超过 `warnAt`（默认 80%）进入预警态并显示「管理额度」入口。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">本月 API 用量（上方 62% 正常，下方 87% 预警）</div>
  <VaUsageMeter :segments="usageSegments" :limit="1000000" unit="tokens" period="本月 · 8 月 1 日重置" />
  <div style="margin-top: 20px;">
    <VaUsageMeter :segments="usageWarnSegments" :limit="1000000" unit="tokens" period="本月 · 8 月 1 日重置" @manage="onUsageManage" />
  </div>
  <p style="margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-2);">{{ usageMsg }}</p>
</div>

---

## 17. VaNumberTicker — 数字滚动

里程表式数字滚动：进入视口从零数起，数值变化时每一位独立滚动；`format` 透传 `Intl.NumberFormatOptions`。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">运营数据看板（点击按钮观察每位数字独立滚动）</div>
  <div class="demo-row" style="align-items: flex-end;">
    <div>
      <div style="font-size: 12px; color: var(--vp-c-text-2); margin-bottom: 4px;">今日请求数</div>
      <VaNumberTicker :value="tickerValue" :format="{ useGrouping: true }" style="font-size: 32px; font-weight: 700; line-height: 1.2;" />
    </div>
    <div>
      <div style="font-size: 12px; color: var(--vp-c-text-2); margin-bottom: 4px;">本月营收（CNY）</div>
      <VaNumberTicker :value="revenueValue" :format="{ style: 'currency', currency: 'CNY' }" style="font-size: 32px; font-weight: 700; line-height: 1.2;" />
    </div>
    <VaButton variant="secondary" @click="bumpTicker">模拟新增 1,357 次请求</VaButton>
  </div>
</div>

---

## 18. VaSkeleton + VaShimmerText — 骨架屏与微光文字

两者共享同一道柔和扫光：`VaSkeleton` 以块级占位保护内容布局（`circle` 画头像），`VaShimmerText` 让等待中的文案自带微光。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">回答生成中的加载占位</div>
  <div style="display: flex; gap: 16px; align-items: flex-start;">
    <VaSkeleton :height="44" circle />
    <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
      <VaSkeleton width="35%" :height="14" />
      <VaSkeleton width="92%" />
      <VaSkeleton width="78%" />
      <VaSkeleton width="60%" />
    </div>
  </div>
  <div style="margin-top: 20px; font-size: 14px;">
    <VaShimmerText :duration="2.4">正在基于 12 篇文档生成回答…</VaShimmerText>
  </div>
</div>

---

## 19. VaProfileMenu — 个人菜单

首字母色块头像 + 未读徽标，展开后为用户信息头与菜单列表，危险项标红，Esc / 外部点击关闭。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">账户菜单（右上角有 3 条未读，试试标红的退出登录）</div>
  <div class="demo-row">
    <VaProfileMenu
      name="张北"
      email="zhangbei@vuagent.dev"
      :badge="3"
      :items="profileItems"
      @select="onProfileSelect"
    />
    <span style="font-size: 13px; color: var(--vp-c-text-2);">{{ profileMsg }}</span>
  </div>
</div>
