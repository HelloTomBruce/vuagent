<script setup lang="ts">
import { ref } from "vue";
import {
  VaButton,
  VaConfirmHost,
  VaDialog,
  VaDropdown,
  VaPopover,
  VaSelect,
  VaTooltip,
  vaConfirm,
} from "@vuagent/ui";
import type { DropdownItem, SelectOption } from "@vuagent/ui";

/* ================= Select：纯选择型下拉 ================= */
const framework = ref("");
const frameworkOptions: SelectOption[] = [
  { value: "vue", label: "Vue", group: "前端", description: "渐进式框架" },
  { value: "react", label: "React", group: "前端" },
  { value: "svelte", label: "Svelte", group: "前端", disabled: true },
  { value: "nuxt", label: "Nuxt", group: "元框架" },
  { value: "next", label: "Next.js", group: "元框架" },
];
const multi = ref<string[]>(["vue"]);

/* ================= Dropdown：动作菜单 ================= */
const rowActions: DropdownItem[] = [
  { id: "open", label: "打开", icon: "↗", shortcut: "⌘O" },
  { id: "rename", label: "重命名", icon: "✎", shortcut: "F2" },
  { id: "pin", label: "置顶", icon: "📌", checked: true },
  { id: "share", label: "分享", icon: "🔗", children: [
    { id: "copy-link", label: "复制链接", shortcut: "⌘C" },
    { id: "export", label: "导出为 Markdown" },
  ] },
  { id: "d1", divider: true },
  { id: "del", label: "删除", icon: "🗑", danger: true, shortcut: "⌫" },
];
const lastAction = ref("（尚未选择）");

/* ================= Tooltip ================= */
// 无状态——纯 hover/focus

/* ================= Popover：原语 ================= */
const popoverLog = ref("（未打开过）");

/* ================= Dialog ================= */
const dialogOpen = ref(false);

/* ================= Confirm：命令式 ================= */
const confirmResult = ref("（尚未发起）");
async function askConfirm() {
  confirmResult.value = "等待决策…";
  const ok = await vaConfirm({
    title: "删除这个会话？",
    description: "会话的全部消息与工具调用记录将被清除，此操作不可撤销。",
    confirmText: "删除",
    tone: "danger",
    icon: true,
  });
  confirmResult.value = ok ? "✅ 已确认（resolve true）" : "❌ 已取消（resolve false）";
}
</script>

<template>
  <div class="ov">
    <p class="ov__lead">
      Overlay 组件族实操验收：VaSelect / VaDropdown / VaTooltip / VaPopover / VaDialog / VaConfirm。
      均可键盘操作（Tab 聚焦，↑↓/Enter/Esc 导航），右上角可切暗色主题。
    </p>

    <div class="ov__grid">
      <!-- ============ VaSelect ============ -->
      <section class="ov__panel">
        <h3>VaSelect · 下拉选择</h3>
        <div class="ov__row">
          <VaSelect
            v-model="framework"
            :options="frameworkOptions"
            searchable
            clearable
            label="选择框架"
            placeholder="选择框架…"
          />
        </div>
        <p class="ov__hint">分组 + 可搜索 + 可清除；键盘 ↑↓ 导航、Enter 选中、Esc 还原焦点。</p>
        <div class="ov__row">
          <VaSelect v-model="multi" :options="frameworkOptions" multiple label="多选框架" />
        </div>
        <p class="ov__hint">多选：{{ multi.length ? multi.join("、") : "（空）" }}（Space 切换，选中不关闭）</p>
        <p class="ov__hint">单选值：{{ framework || "（空）" }}</p>
      </section>

      <!-- ============ VaDropdown ============ -->
      <section class="ov__panel">
        <h3>VaDropdown · 动作菜单</h3>
        <div class="ov__row">
          <VaDropdown :items="rowActions" @select="(i) => (lastAction = `${i.label}（${i.id}）`)">
            <!-- 点击切换由 VaPopover 的 trigger 包装元素自动承担；插槽内不要再绑 @click="toggle"
                 （否则同一次点击被 toggle 两次：先开后关，表现为「点击没反应」）。
                 触发器用原生 button：aria-expanded 直接落在交互控件上，不依赖组件 attr 透传 -->
            <template #trigger="{ open }">
              <button class="ov__dd-trigger" type="button" :aria-expanded="open">
                行操作 ⋯
              </button>
            </template>
          </VaDropdown>
        </div>
        <p class="ov__hint">含 shortcut / checked 对勾 / 一层子菜单（分享 →）/ danger 删除项。</p>
        <p class="ov__hint">最近选择：{{ lastAction }}</p>
      </section>

      <!-- ============ VaTooltip ============ -->
      <section class="ov__panel">
        <h3>VaTooltip · 文字提示</h3>
        <div class="ov__row">
          <VaTooltip content="保存更改（⌘S）" placement="top">
            <VaButton variant="secondary" size="sm">top（默认）</VaButton>
          </VaTooltip>
          <VaTooltip content="从右侧弹出" placement="right">
            <VaButton variant="secondary" size="sm">right</VaButton>
          </VaTooltip>
          <VaTooltip content="default 变体：卡片底" placement="bottom" variant="default">
            <VaButton variant="secondary" size="sm">bottom · default</VaButton>
          </VaTooltip>
          <VaTooltip content="立即显示（delay=0）" placement="left" :delay="0">
            <VaButton variant="secondary" size="sm">left · delay 0</VaButton>
          </VaTooltip>
        </div>
        <p class="ov__hint">hover 或 Tab 聚焦后延迟 300ms 显示；Esc 立即关闭；trigger 自动回填 aria-describedby。</p>
      </section>

      <!-- ============ VaPopover ============ -->
      <section class="ov__panel">
        <h3>VaPopover · 浮层原语</h3>
        <div class="ov__row">
          <VaPopover
            placement="bottom-start"
            @open="popoverLog = '已打开'"
            @close="popoverLog = '已关闭'"
          >
            <template #trigger="{ open }">
              <VaButton variant="secondary" size="sm">点击{{ open ? "关闭" : "打开" }}浮层</VaButton>
            </template>
            <div class="ov__pop">
              <strong>快捷键设置</strong>
              <p class="ov__hint">浮层内容自定义；点外部或 Esc 关闭（仅栈顶响应）。</p>
              <VaButton size="sm">浮层内按钮</VaButton>
            </div>
          </VaPopover>
        </div>
        <p class="ov__hint">状态：{{ popoverLog }}</p>
      </section>

      <!-- ============ VaDialog ============ -->
      <section class="ov__panel">
        <h3>VaDialog · 模态弹窗</h3>
        <div class="ov__row">
          <VaButton variant="primary" size="sm" @click="dialogOpen = true">打开弹窗</VaButton>
        </div>
        <p class="ov__hint">焦点陷阱（Tab 循环）+ Esc/遮罩关闭 + 关闭后焦点还原 + body 滚动锁。</p>
      </section>

      <!-- ============ VaConfirm ============ -->
      <section class="ov__panel">
        <h3>VaConfirm · 命令式确认</h3>
        <div class="ov__row">
          <VaButton variant="destructive" size="sm" @click="askConfirm">vaConfirm({ tone: "danger" })</VaButton>
        </div>
        <p class="ov__hint">await 返回 Promise&lt;boolean&gt;；危险操作初始聚焦「取消」（安全默认）。</p>
        <p class="ov__hint">结果：{{ confirmResult }}</p>
      </section>
    </div>

    <VaDialog
      v-model:open="dialogOpen"
      title="编辑预设"
      description="修改将应用到全部新会话。"
      size="sm"
    >
      <p class="ov__hint">这是 VaDialog 的主体插槽内容。Tab 在焦点陷阱内循环，Esc 关闭。</p>
      <template #footer="{ close }">
        <VaButton variant="secondary" size="sm" @click="close">取消</VaButton>
        <VaButton variant="primary" size="sm" @click="close">保存</VaButton>
      </template>
    </VaDialog>

    <!-- vaConfirm 的渲染宿主（全局单例模式，页内挂一次即可） -->
    <VaConfirmHost />
  </div>
</template>

<style scoped>
.ov { display: flex; flex-direction: column; gap: 16px; }
.ov__lead { margin: 0; font-size: 13px; color: var(--va-muted, #6f6d66); }
.ov__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; align-items: start; }
.ov__panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  min-width: 0;
}
.ov__panel h3 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--va-muted, #6f6d66);
}
.ov__row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
.ov__hint { font-size: 12px; color: var(--va-muted, #6f6d66); margin: 6px 0 0; }
.ov__pop { padding: 4px 2px; display: flex; flex-direction: column; gap: 6px; min-width: 200px; }
.ov__dd-trigger {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-m, 10px);
  color: var(--va-ink-2, #43413c);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.ov__dd-trigger:hover { border-color: var(--va-accent, #c2410c); color: var(--va-accent, #c2410c); }
</style>
