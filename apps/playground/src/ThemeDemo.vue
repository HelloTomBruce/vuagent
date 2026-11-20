<script setup lang="ts">
/**
 * 主题演示页（用户需求：画廊后新增主题 tab）
 * 展示主题定制能力与方式：
 * 1. 三态亮暗切换（复用 useTheme，与顶栏同一 store 联动）
 * 2. 全局换肤 live 预设（写 html 内联 --va-accent 三件套，全库组件即时跟随）
 * 3. 局部换肤 / 局部暗色（CSS 变量级联 + tokens.css 的 [data-theme] 任意祖先选择器）
 * 4. 组件级覆盖（L3 组件钩子）
 * 5. L2 语义令牌速查 + 三种方式的代码示例
 */
import { onMounted, onUnmounted, ref } from "vue";
import { VaApprovalCard, VaButton, VaSegmentedControl } from "@vuagent/ui";
import { useTheme, type ThemePreference } from "./console/composables/useTheme";

const { preference, resolved, setPreference } = useTheme();

/* —— 全局换肤预设：写 documentElement 内联变量，即时生效；恢复 = 移除内联属性 —— */
interface AccentPreset {
  key: string;
  label: string;
  accent: string;
  hover: string;
  soft: string;
}
const PRESETS: AccentPreset[] = [
  { key: "calm", label: "默认 · 暖橙", accent: "#c2410c", hover: "#9a3412", soft: "rgba(194, 65, 12, 0.1)" },
  { key: "teal", label: "青瓷", accent: "#0f766e", hover: "#115e59", soft: "rgba(15, 118, 110, 0.1)" },
  { key: "violet", label: "紫罗兰", accent: "#6d28d9", hover: "#5b21b6", soft: "rgba(109, 40, 217, 0.1)" },
  { key: "rose", label: "玫瑰", accent: "#be123c", hover: "#9f1239", soft: "rgba(190, 18, 60, 0.1)" },
  { key: "blue", label: "靛蓝", accent: "#1d4ed8", hover: "#1e40af", soft: "rgba(29, 78, 216, 0.1)" },
];
const activePreset = ref<string | null>(null);

function applyPreset(p: AccentPreset) {
  const root = document.documentElement;
  root.style.setProperty("--va-accent", p.accent);
  root.style.setProperty("--va-accent-hover", p.hover);
  root.style.setProperty("--va-accent-soft", p.soft);
  activePreset.value = p.key;
}

function resetPreset() {
  const root = document.documentElement;
  root.style.removeProperty("--va-accent");
  root.style.removeProperty("--va-accent-hover");
  root.style.removeProperty("--va-accent-soft");
  activePreset.value = null;
}

onUnmounted(resetPreset);

/* —— 全量令牌参考：分组与描述静态维护，值运行时从 CSSOM 读取（tokens.css 改动零漂移）—— */
const TOKEN_GROUPS: Array<{ title: string; items: Array<{ name: string; desc: string }> }> = [
  {
    title: "色彩（L1）",
    items: [
      { name: "--va-bg", desc: "页面底色" },
      { name: "--va-bg-subtle", desc: "次级底色（输入框/hover 面）" },
      { name: "--va-card", desc: "卡片表面" },
      { name: "--va-ink", desc: "主文字 / 墨色实底" },
      { name: "--va-ink-2", desc: "次级文字" },
      { name: "--va-muted", desc: "弱化文字 / 占位" },
      { name: "--va-edge", desc: "描边" },
      { name: "--va-edge-strong", desc: "强描边（激活/危险边）" },
      { name: "--va-accent", desc: "强调色（主操作/链接/焦点）" },
      { name: "--va-accent-hover", desc: "accent 悬停态" },
      { name: "--va-accent-soft", desc: "accent 弱底（选中底/徽标底）" },
      { name: "--va-success", desc: "成功" },
      { name: "--va-warning", desc: "警告" },
      { name: "--va-danger", desc: "危险" },
      { name: "--va-info", desc: "信息" },
    ],
  },
  {
    title: "语义对照色（实底上的文字）",
    items: [
      { name: "--va-accent-contrast", desc: "accent 实底文字（暗色换深墨，≈7.3:1）" },
      { name: "--va-success-contrast", desc: "success 实底文字" },
      { name: "--va-warning-contrast", desc: "warning 实底文字" },
      { name: "--va-danger-contrast", desc: "danger 实底文字" },
      { name: "--va-info-contrast", desc: "info 实底文字" },
    ],
  },
  {
    title: "遮罩与骨架屏",
    items: [
      { name: "--va-scrim", desc: "弹窗/浮层遮罩压暗" },
      { name: "--va-skel-bg", desc: "骨架屏底" },
      { name: "--va-skel-hl", desc: "骨架屏高光" },
    ],
  },
  {
    title: "圆角",
    items: [
      { name: "--va-radius-s", desc: "小圆角（按钮/输入）" },
      { name: "--va-radius-m", desc: "中圆角（卡片内块）" },
      { name: "--va-radius-l", desc: "大圆角（卡片/弹窗）" },
      { name: "--va-radius-pill", desc: "胶囊（999px）" },
    ],
  },
  {
    title: "间距（4px 栅格 + 半步）",
    items: [
      { name: "--va-s1", desc: "2px" },
      { name: "--va-s2", desc: "4px" },
      { name: "--va-s3", desc: "8px" },
      { name: "--va-s3h", desc: "半步 6px" },
      { name: "--va-s4", desc: "12px" },
      { name: "--va-s4h", desc: "半步 10px" },
      { name: "--va-s5", desc: "16px" },
      { name: "--va-s6", desc: "24px" },
      { name: "--va-s7", desc: "32px" },
    ],
  },
  {
    title: "排版",
    items: [
      { name: "--va-fs-2xs", desc: "字号 10px" },
      { name: "--va-fs-xs", desc: "字号 11px" },
      { name: "--va-fs-sm", desc: "字号 12px" },
      { name: "--va-fs-md", desc: "字号 13px（正文默认）" },
      { name: "--va-fs-lg", desc: "字号 14px" },
      { name: "--va-fs-xl", desc: "字号 16px" },
      { name: "--va-fs-2xl", desc: "字号 20px" },
      { name: "--va-lh-tight", desc: "行高 1.3（紧凑）" },
      { name: "--va-lh-normal", desc: "行高 1.5（常规）" },
      { name: "--va-fw-medium", desc: "字重 500" },
      { name: "--va-fw-semibold", desc: "字重 600" },
      { name: "--va-fw-bold", desc: "字重 700" },
      { name: "--va-tracking-wide", desc: "字距 0.04em（标签）" },
      { name: "--va-tracking-wider", desc: "字距 0.06em（大写）" },
    ],
  },
  {
    title: "尺寸（控件 / 图标）",
    items: [
      { name: "--va-h-sm", desc: "控件高 30px" },
      { name: "--va-h-md", desc: "控件高 36px" },
      { name: "--va-h-lg", desc: "控件高 44px" },
      { name: "--va-icon-sm", desc: "图标 14px" },
      { name: "--va-icon-md", desc: "图标 16px" },
      { name: "--va-icon-lg", desc: "图标 18px" },
    ],
  },
  {
    title: "层级（z-index 阶梯）",
    items: [
      { name: "--va-z-base", desc: "0 · 常规流" },
      { name: "--va-z-raised", desc: "10 · 卡内浮起" },
      { name: "--va-z-sticky", desc: "50 · 吸顶" },
      { name: "--va-z-dropdown", desc: "70 · 下拉浮层" },
      { name: "--va-z-overlay", desc: "80 · 弹窗遮罩" },
      { name: "--va-z-popover-inner", desc: "90 · 遮罩内浮层" },
      { name: "--va-z-toast", desc: "1000 · 全局通知" },
    ],
  },
  {
    title: "阴影",
    items: [
      { name: "--va-shadow-1", desc: "一级（卡片微浮）" },
      { name: "--va-shadow-2", desc: "二级（下拉/抽屉）" },
      { name: "--va-shadow-3", desc: "三级（弹窗）" },
    ],
  },
  {
    title: "动效（编排协议）",
    items: [
      { name: "--va-ease", desc: "标准缓动" },
      { name: "--va-ease-out-quart", desc: "入场缓动（快出慢停）" },
      { name: "--va-ease-in-quad", desc: "离场缓动（慢出快收）" },
      { name: "--va-ease-spring", desc: "弹性过冲（成功反馈）" },
      { name: "--va-dur-1", desc: "120ms（hover/按压）" },
      { name: "--va-dur-2", desc: "200ms" },
      { name: "--va-dur-3", desc: "300ms" },
      { name: "--va-dur-in", desc: "浮层入场 180ms" },
      { name: "--va-dur-out", desc: "浮层离场 140ms（更快更短）" },
      { name: "--va-dist-s", desc: "位移 4px" },
      { name: "--va-dist-m", desc: "位移 8px" },
      { name: "--va-dur-loop", desc: "循环动画底速 1.8s" },
    ],
  },
  {
    title: "字体",
    items: [
      { name: "--va-font", desc: "无衬线主字体栈" },
      { name: "--va-font-mono", desc: "等宽字体栈" },
    ],
  },
];

/** 运行时收集 tokens.css 的亮/暗两组值（读 CSSOM 而非复制字面，改动零漂移） */
const tokenLight = ref<Record<string, string>>({});
const tokenDark = ref<Record<string, string>>({});

function collectTokens() {
  const lightMap: Record<string, string> = {};
  const darkMap: Record<string, string> = {};
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表不可枚举，跳过
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const sel = (rule.selectorText || "").trim();
      const target = /dark/i.test(sel) ? darkMap : sel === ":root" ? lightMap : null;
      if (!target) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style.item(i);
        if (prop.startsWith("--va-")) target[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  }
  tokenLight.value = lightMap;
  tokenDark.value = darkMap;
}

const isColorValue = (v?: string) => !!v && /^#|^rgb|^hsl|^color-mix/.test(v.trim());
const lv = (name: string) => tokenLight.value[name];
const dv = (name: string) => tokenDark.value[name];
const tokenTotal = TOKEN_GROUPS.reduce((n, g) => n + g.items.length, 0);

onMounted(collectTokens);

/* 三态切换选项（供 SegmentedControl） */
const themeOptions = [
  { value: "light", label: "☀ 亮色" },
  { value: "dark", label: "🌙 暗色" },
  { value: "system", label: "🖥 跟随系统" },
];

function onThemeSeg(v: unknown) {
  setPreference(v as ThemePreference);
}
</script>

<template>
  <div class="td">
    <header class="td__hero">
      <h2>主题定制</h2>
      <p>
        全库由 CSS 变量驱动，<strong>不做 JS 主题引擎</strong>——覆盖变量即可换肤。
        三层模型：<code>L1</code> 基础令牌（色彩/圆角/间距）· <code>L2</code> 语义令牌（字号/高度/动效）·
        <code>L3</code> 组件钩子（<code>--va-&lt;组件&gt;-*</code>）。
      </p>
    </header>

    <div class="td__grid">
      <!-- 三态亮暗切换 -->
      <section class="td__panel">
        <h3>① 亮 / 暗 / 跟随系统</h3>
        <p class="td__desc">
          宿主写 <code>data-theme</code> 属性 + <code>color-scheme</code>，组件零感知。
          system 态监听 <code>prefers-color-scheme</code> 实时跟随；与顶栏的切换器共用同一状态，localStorage 持久化、首帧无闪烁。
        </p>
        <VaSegmentedControl
          :model-value="preference"
          full-width
          aria-label="主题三态切换"
          :options="themeOptions"
          @update:model-value="onThemeSeg"
        />
        <p class="td__hint">当前解析：{{ resolved === "dark" ? "暗色" : "亮色" }}</p>
      </section>

      <!-- 全局换肤 live -->
      <section class="td__panel">
        <h3>② 全局换肤（即时生效）</h3>
        <p class="td__desc">
          只改 <code>--va-accent / -hover / -soft</code> 三个变量，全部组件的强调色即时跟随：
        </p>
        <div class="td__swatches">
          <button
            v-for="p in PRESETS"
            :key="p.key"
            type="button"
            class="td__swatch"
            :class="{ 'td__swatch--on': activePreset === p.key }"
            :style="{ '--sw': p.accent }"
            :title="p.label"
            @click="applyPreset(p)"
          >
            <span class="td__swatch-dot" aria-hidden="true" />
            <span class="td__swatch-label">{{ p.label }}</span>
          </button>
          <VaButton v-if="activePreset" variant="ghost" size="sm" @click="resetPreset">恢复默认</VaButton>
        </div>
        <div class="td__live-row">
          <span class="td__accent-text">accent 文字 · <code>var(--va-accent)</code> 实时跟随</span>
          <VaButton>主要按钮</VaButton>
          <VaButton variant="secondary">次要</VaButton>
          <VaApprovalCard
            title="agent 想安装新的开发依赖"
            detail="vitest · 用于构建验证"
            risk="high"
            preview="pnpm add -D vitest"
            :countdown="120"
          />
        </div>
        <p class="td__hint">正式换肤在 <code>tokens.css</code> 的 :root 改（亮/暗两块同步），此处为运行时演示。</p>
      </section>

      <!-- 局部换肤 / 局部暗色 -->
      <section class="td__panel">
        <h3>③ 局部换肤 · 局部暗色</h3>
        <p class="td__desc">
          CSS 变量随级联作用域生效：任意祖先节点覆盖令牌，只影响子树；
          暗色同样支持——<code>data-theme="dark"</code> 可挂在任意祖先，不止 html。
        </p>
        <div class="td__scopes">
          <div
            class="td__scope"
            style="--va-accent: #0f766e; --va-accent-hover: #115e59; --va-accent-soft: rgba(15, 118, 110, 0.1)"
          >
            <span class="td__scope-tag">局部青色</span>
            <span class="td__accent-text">accent 文字</span>
            <VaButton variant="secondary">子树内按钮</VaButton>
            <VaButton variant="secondary">同样跟随</VaButton>
          </div>
          <div class="td__scope" data-theme="dark">
            <span class="td__scope-tag">局部暗色</span>
            <span class="td__accent-text">accent 文字（暗色取值）</span>
            <VaButton variant="secondary">暗底次级</VaButton>
            <VaButton variant="ghost">幽灵按钮</VaButton>
          </div>
        </div>
      </section>

      <!-- 组件级覆盖 -->
      <section class="td__panel">
        <h3>④ 组件级覆盖（L3 钩子）</h3>
        <p class="td__desc">每个组件暴露 <code>--va-&lt;组件&gt;-*</code> 局部变量，内联即可单点覆盖：</p>
        <div class="row">
          <VaButton style="--va-btn-ink: #4338ca">紫色墨底按钮</VaButton>
          <VaButton variant="secondary" style="--va-btn-ink: #0f766e">青色描边</VaButton>
        </div>
        <pre class="td__code">&lt;VaButton style="--va-btn-ink: #4338ca"&gt;…&lt;/VaButton&gt;</pre>
      </section>

      <!-- 全量令牌参考 -->
      <section class="td__panel td__panel--wide">
        <h3>⑤ 全量令牌参考（L1 基础 + L2 语义，共 {{ tokenTotal }} 个）</h3>
        <p class="td__desc">
          值运行时读取自已加载的 <code>tokens.css</code>（令牌改动零漂移）；带色点的令牌同时展示亮/暗两套取值。
          换肤即覆盖这些变量；<code>L3</code> 组件钩子（<code>--va-&lt;组件&gt;-*</code>）随各组件文档提供，不在此枚举。
        </p>
        <div v-for="g in TOKEN_GROUPS" :key="g.title" class="td__tgroup">
          <h4>{{ g.title }}<small>{{ g.items.length }}</small></h4>
          <table class="td__table">
            <tbody>
              <tr v-for="it in g.items" :key="it.name">
                <td class="td__tname"><code>{{ it.name }}</code></td>
                <td class="td__tvals">
                  <template v-if="isColorValue(lv(it.name))">
                    <span class="td__dot" :style="{ background: lv(it.name) }" aria-hidden="true" />
                    <span class="td__tval">{{ lv(it.name) }}</span>
                    <span v-if="dv(it.name) !== lv(it.name)" class="td__dotpair">
                      <span class="td__dot td__dot--dark" :style="{ background: dv(it.name) }" aria-hidden="true" />
                      <span class="td__tval td__tval--dark">{{ dv(it.name) }}</span>
                    </span>
                  </template>
                  <template v-else>{{ lv(it.name) || "—" }}</template>
                </td>
                <td class="td__tdesc">{{ it.desc }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 代码方式 -->
      <section class="td__panel td__panel--wide">
        <h3>⑥ 三种定制方式（代码）</h3>
        <div class="td__codes">
          <figure class="td__codecard">
            <figcaption>宿主：三态切换 + 跟随系统（playground 实装见 useTheme.ts）</figcaption>
            <pre class="td__code">const mq = matchMedia("(prefers-color-scheme: dark)");
function apply() {
  const theme = pref === "dark" || (pref === "system" && mq.matches)
    ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme; // 原生控件跟随
}
mq.addEventListener("change", () => { if (pref === "system") apply(); });</pre>
          </figure>
          <figure class="td__codecard">
            <figcaption>全局换肤：覆盖 L1/L2 令牌</figcaption>
            <pre class="td__code">:root {
  --va-accent: #0f766e;   /* 换强调色，全库跟随 */
  --va-radius-m: 12px;    /* 控件更圆润 */
  --va-dur-loop: 1.2s;    /* 循环动画加速 */
}</pre>
          </figure>
          <figure class="td__codecard">
            <figcaption>组件级覆盖：L3 钩子</figcaption>
            <pre class="td__code">&lt;VaApprovalCard
  style="--va-apr-risk-high: #b42318"
  risk="high" /&gt;</pre>
          </figure>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.td { display: grid; gap: 16px; }
.td__hero h2 { margin: 0 0 6px; font-size: 20px; }
.td__hero p { margin: 0; color: var(--va-muted, #6f6d66); font-size: var(--va-fs-md, 13px); line-height: 1.6; }
.td__hero code { background: var(--va-accent-soft, rgba(194, 65, 12, 0.1)); color: var(--va-accent, #c2410c); border-radius: 4px; padding: 1px 5px; font-size: 12px; }

.td__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; align-items: start; }
.td__panel {
  background: var(--va-card, #fff);
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-l, 16px);
  padding: 16px;
  display: grid;
  gap: 10px;
  justify-items: start;
  min-width: 0;
}
.td__panel--wide { grid-column: 1 / -1; }
.td__panel h3 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--va-muted, #6f6d66); }
.td__desc { margin: 0; font-size: var(--va-fs-md, 13px); color: var(--va-ink-2, #43413c); line-height: 1.6; }
.td__desc code { background: var(--va-bg-subtle, #efede7); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.td__hint { margin: 0; font-size: var(--va-fs-xs, 11px); color: var(--va-muted, #6f6d66); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

/* 换肤预设色板 */
.td__swatches { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.td__swatch {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  background: var(--va-card, #fff);
  border-radius: var(--va-radius-pill, 999px);
  padding: 4px 10px 4px 6px;
  cursor: pointer;
  font-size: var(--va-fs-xs, 11px);
  color: var(--va-ink-2, #43413c);
  transition: border-color var(--va-dur-1, 120ms) var(--va-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.td__swatch:hover { border-color: var(--sw); color: var(--va-ink, #1a1917); }
.td__swatch--on { border-color: var(--sw); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sw) 25%, transparent); }
.td__swatch-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--sw); }
.td__live-row { display: grid; gap: 10px; width: 100%; justify-items: start; }
.td__accent-text { font-size: var(--va-fs-md, 13px); font-weight: var(--va-fw-semibold, 600); color: var(--va-accent, #c2410c); }

/* 局部作用域演示卡 */
.td__scopes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }
.td__scope {
  display: grid; gap: 8px; justify-items: start;
  border: 1px dashed var(--va-edge, rgba(26, 25, 23, 0.12));
  border-radius: var(--va-radius-m, 10px);
  padding: 12px;
}
.td__scope[data-theme="dark"] { background: var(--va-bg, #141311); border-style: solid; }
.td__scope-tag { font-size: var(--va-fs-2xs, 10px); letter-spacing: var(--va-tracking-wider, 0.06em); text-transform: uppercase; color: var(--va-muted, #6f6d66); }

/* 代码块 */
.td__code {
  margin: 0; padding: 10px 12px; width: 100%;
  background: var(--va-bg-subtle, #efede7);
  border-radius: var(--va-radius-s, 8px);
  font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: var(--va-fs-xs, 11px);
  line-height: 1.6;
  color: var(--va-ink-2, #43413c);
  overflow-x: auto;
  white-space: pre;
}
.td__codes { display: grid; gap: 12px; width: 100%; }
.td__codecard { margin: 0; display: grid; gap: 6px; }
.td__codecard figcaption { font-size: var(--va-fs-xs, 11px); color: var(--va-muted, #6f6d66); }

/* 全量令牌参考 */
.td__tgroup { width: 100%; }
.td__tgroup + .td__tgroup { margin-top: 12px; }
.td__tgroup h4 { margin: 0 0 4px; font-size: var(--va-fs-xs, 11px); color: var(--va-ink, #1a1917); display: flex; align-items: center; gap: 6px; }
.td__tgroup h4 small { color: var(--va-muted, #6f6d66); font-weight: var(--va-fw-medium, 500); }
.td__table { width: 100%; border-collapse: collapse; font-size: var(--va-fs-sm, 12px); }
.td__table th { text-align: left; padding: 6px 10px; color: var(--va-muted, #6f6d66); font-weight: var(--va-fw-semibold, 600); border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12)); }
.td__table td { padding: 5px 10px; border-bottom: 1px solid var(--va-edge, rgba(26, 25, 23, 0.08)); color: var(--va-ink-2, #43413c); vertical-align: middle; }
.td__table td:first-child code { background: var(--va-bg-subtle, #efede7); border-radius: 4px; padding: 1px 5px; font-size: 11px; white-space: nowrap; }
.td__tname { width: 30%; }
.td__tvals { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.td__tval { font-family: var(--va-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: var(--va-fs-2xs, 10px); }
.td__tval--dark { color: var(--va-muted, #6f6d66); }
.td__dot { display: inline-block; width: 12px; height: 12px; border-radius: 4px; border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12)); flex-shrink: 0; }
.td__dotpair { display: inline-flex; align-items: center; gap: 4px; padding-left: 8px; border-left: 1px dashed var(--va-edge, rgba(26, 25, 23, 0.12)); }
.td__tdesc { width: 32%; color: var(--va-muted, #6f6d66); font-size: var(--va-fs-xs, 11px); }

@media (prefers-reduced-motion: reduce) {
  .td__swatch { transition: none; }
}
</style>
