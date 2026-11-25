<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VaTextReveal,
  VaBlurCrossfade,
  VaGradientFloor,
  VaGradientText,
  VaGridBackground,
  VaTiltCard,
  VaSpotlightCard,
  VaScrimEdge,
  VaGradientBorder,
  VaVoiceOrb,
  VaAgentTeam,
  VaModelWheel,
} from "@vuagent/ui";

// —— 1. VaTextReveal：点击重播（key 自增触发重挂载，滚入视口重新播放） ——
const revealKey = ref(0);

function replayReveal() {
  revealKey.value += 1;
}

// —— 2. VaBlurCrossfade：任务阶段切换 ——
type TaskPhase = "queued" | "running" | "done";

const phase = ref<TaskPhase>("queued");

const phaseMeta: Record<TaskPhase, { label: string; hint: string }> = {
  queued: { label: "排队中", hint: "任务已提交至执行队列，正在等待空闲 Agent 接管。" },
  running: { label: "执行中", hint: "Agent 正在推进工具链：检索资料 → 生成方案 → 自我校验。" },
  done: { label: "已完成", hint: "全部断言通过，执行产物已归档并回传至会话时间线。" },
};

const phases: TaskPhase[] = ["queued", "running", "done"];

// —— 3. 渐变装饰：文字流动开关 ——
const gradientAnimated = ref(true);

function toggleGradientFlow() {
  gradientAnimated.value = !gradientAnimated.value;
}

// —— 4. VaGridBackground：漂移方向切换 ——
type GridDir = "diagonal" | "up" | "down" | "left" | "right";

const gridDirection = ref<GridDir>("diagonal");

const gridDirs: Array<{ key: GridDir; label: string }> = [
  { key: "diagonal", label: "对角" },
  { key: "up", label: "向上" },
  { key: "down", label: "向下" },
  { key: "left", label: "向左" },
  { key: "right", label: "向右" },
];

const gridDirLabel = computed(
  () => gridDirs.find((d) => d.key === gridDirection.value)?.label ?? "对角",
);

// —— 5. VaTiltCard：纯指针交互（hover 驱动），无需额外状态 ——

// —— 7. VaSpotlightCard：发光/光斑开关 + 投影档位 ——
const spotGlow = ref(true);
const spotSpot = ref(true);
type SpotElevation = 1 | 2 | 3 | 4;
const spotElevation = ref<SpotElevation>(4);
const spotElevations: SpotElevation[] = [1, 2, 3, 4];

// —— 8. VaScrimEdge：四向切换 ——
type ScrimDir = "bottom" | "top" | "left" | "right";
const scrimDirection = ref<ScrimDir>("bottom");
const scrimDirs: Array<{ key: ScrimDir; label: string }> = [
  { key: "bottom", label: "底部" },
  { key: "top", label: "顶部" },
  { key: "left", label: "左侧" },
  { key: "right", label: "右侧" },
];

// —— 9. VaGradientBorder：static / running 切换 ——
type BorderVariant = "static" | "running";
const borderVariant = ref<BorderVariant>("static");
const borderVariants: Array<{ key: BorderVariant; label: string }> = [
  { key: "static", label: "静态描边" },
  { key: "running", label: "运行中光环" },
];

// —— 6. 插画三件：语音球状态 / Agent 团队 / 模型轮盘 ——
type OrbState = "idle" | "listening" | "speaking";

const orbState = ref<OrbState>("listening");

const orbStates: Array<{ key: OrbState; label: string }> = [
  { key: "idle", label: "待命" },
  { key: "listening", label: "聆听中" },
  { key: "speaking", label: "说话中" },
];

const orbStateLabel = computed(
  () => orbStates.find((s) => s.key === orbState.value)?.label ?? "待命",
);

const teamAgents = ref([
  { id: "planner", name: "规划器" },
  { id: "coder", name: "编码器" },
  { id: "tester", name: "测试器" },
  { id: "reviewer", name: "评审员" },
  { id: "ops", name: "运维员" },
]);

const wheelModels = ref([
  { id: "glm", name: "GLM" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "qwen", name: "Qwen" },
  { id: "kimi", name: "Kimi" },
  { id: "doubao", name: "Doubao" },
  { id: "hunyuan", name: "Hunyuan" },
]);

// 演示区控制按钮的统一样式（选中态描边跟随品牌色）
function chipStyle(active: boolean) {
  return {
    padding: "5px 14px",
    fontSize: "13px",
    borderRadius: "8px",
    cursor: "pointer",
    border: `1px solid ${active ? "var(--va-accent)" : "var(--va-color-border, #e2e8f0)"}`,
    color: active ? "var(--va-accent)" : "var(--vp-c-text-1)",
    background: "var(--va-color-surface, #ffffff)",
    fontWeight: active ? 600 : 400,
  };
}
</script>

# 动效与插画组件

> 轻量动效与纯 CSS / SVG 插画：文字逐字浮现、内容模糊切换、渐变文字与底部光晕、缓慢漂移的网格底纹、指针驱动的 3D 倾斜卡片、聚光/渐隐/渐变边框三件光影原语，以及三件开箱即用的装饰插画——为零依赖的产品界面注入质感。所有动效均遵循 `prefers-reduced-motion` 自动降级。

---

## 1. VaTextReveal — 文字逐字浮现

基于 IntersectionObserver 的入场动效：文本按词或字切分后，从轻微模糊与位移中错峰浮现，滚入视口自动触发。`once` 置为 `false` 时，离开视口再回来会重新播放。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">逐字浮现效果（滚入视口自动播放，可点击重新播放）</div>
  <VaTextReveal
    :key="revealKey"
    text="让智能体的每一次回应，都从沉静中缓缓浮现"
    by="char"
    :stagger="90"
    :delay="120"
    :duration="520"
    as="h3"
    :once="false"
    style="font-size:26px;line-height:1.6;"
  />
  <div style="margin-top:16px;">
    <button type="button" :style="chipStyle(false)" @click="replayReveal">重新播放</button>
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaTextReveal } from "@vuagent/ui";
</script>

<template>
  <VaTextReveal
    text="让智能体的每一次回应，都从沉静中缓缓浮现"
    by="char"
    :stagger="90"
    :delay="120"
    :duration="520"
    as="h3"
    :once="false"
  />
</template>
```

---

## 2. VaBlurCrossfade — 模糊淡入淡出切换

内容切换键 `target` 变化时，旧内容模糊淡出、新内容模糊淡入并微微上浮，适合任务阶段、 tab 面板等轻量状态切换场景；时长、模糊半径与位移均可调。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">任务阶段切换过渡（点击按钮，观察模糊交叉过渡）</div>
  <div style="display:flex;gap:8px;margin-bottom:16px;">
    <button
      v-for="p in phases"
      :key="p"
      type="button"
      :style="chipStyle(phase === p)"
      @click="phase = p"
    >{{ phaseMeta[p].label }}</button>
  </div>
  <VaBlurCrossfade :target="phase" :duration="360" :blur="10" :rise="10">
    <div style="padding:16px 20px;border:1px solid var(--va-color-border, #e2e8f0);border-radius:10px;background:var(--va-color-surface-soft, #f8fafc);">
      <strong>当前阶段：{{ phaseMeta[phase].label }}</strong>
      <p style="margin:6px 0 0;font-size:13px;line-height:1.7;color:var(--vp-c-text-2);">{{ phaseMeta[phase].hint }}</p>
    </div>
  </VaBlurCrossfade>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { ref } from "vue";
import { VaBlurCrossfade } from "@vuagent/ui";

const phase = ref<"queued" | "running" | "done">("running");
</script>

<template>
  <VaBlurCrossfade :target="phase" :duration="360" :blur="10" :rise="10">
    <p>当前阶段：{{ phase }}</p>
  </VaBlurCrossfade>
</template>
```

---

## 3. VaGradientFloor / VaGradientText — 渐变文字与渐变地面光

一对纯装饰组件：`VaGradientFloor` 在宿主底部铺双色光晕并缓慢呼吸（宿主需提供 `relative` 定位容器）；`VaGradientText` 用 `background-clip` 渲染渐变文字，开启 `animated` 后渐变会缓慢流动。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">底部光晕呼吸 + 渐变文字（当前流动状态：{{ gradientAnimated ? "开启" : "已暂停" }}）</div>
  <div style="position:relative;overflow:hidden;border-radius:10px;padding:48px 24px 72px;text-align:center;">
    <VaGradientFloor :height="280" :position="0.5" :opacity="0.6" breathing />
    <div style="position:relative;font-size:30px;font-weight:700;line-height:1.4;">
      <VaGradientText text="轻量动效，为产品界面注入质感" :angle="120" :animated="gradientAnimated" />
    </div>
    <p style="position:relative;margin:10px 0 0;font-size:13px;color:var(--vp-c-text-2);">双色光晕在页面底部缓缓呼吸，渐变文字沿 120° 缓慢流动。</p>
  </div>
  <div style="margin-top:16px;">
    <button type="button" :style="chipStyle(gradientAnimated)" @click="toggleGradientFlow">{{ gradientAnimated ? "暂停流动" : "开启流动" }}</button>
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaGradientFloor, VaGradientText } from "@vuagent/ui";
</script>

<template>
  <!-- Floor 是绝对定位装饰层：宿主容器需 position:relative 并建议 overflow:hidden -->
  <div style="position:relative;overflow:hidden;padding:48px 24px;text-align:center;">
    <VaGradientFloor :height="280" :position="0.5" :opacity="0.6" breathing />
    <VaGradientText text="轻量动效，为产品界面注入质感" :angle="120" animated />
  </div>
</template>
```

---

## 4. VaGridBackground — 网格背景

缓慢漂移的细网格底纹，边缘自然渐隐，适合作 Hero 区或空态页的背景层；业务内容放在默认插槽，层级始终位于网格之上。支持五个漂移方向，`speed` 设为 `0` 可完全静止。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">网格底纹漂移中 · 当前方向：{{ gridDirLabel }}</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
    <button
      v-for="d in gridDirs"
      :key="d.key"
      type="button"
      :style="chipStyle(gridDirection === d.key)"
      @click="gridDirection = d.key"
    >{{ d.label }}</button>
  </div>
  <VaGridBackground :size="44" :speed="1.2" :direction="gridDirection" :fade="80">
    <div style="padding:56px 24px;text-align:center;">
      <div style="font-size:20px;font-weight:700;">让每个界面都有呼吸感</div>
      <p style="margin:8px 0 0;font-size:13px;color:var(--vp-c-text-2);">缓慢漂移的网格底纹 · 边缘渐隐 · 内容置于默认插槽之上</p>
    </div>
  </VaGridBackground>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaGridBackground } from "@vuagent/ui";
</script>

<template>
  <VaGridBackground :size="44" :speed="1.2" direction="diagonal" :fade="80">
    <div style="padding:56px 24px;text-align:center;">Hero 文案放在默认插槽</div>
  </VaGridBackground>
</template>
```

---

## 5. VaTiltCard — 3D 倾斜卡片

指针驱动的 3D 倾斜卡：鼠标悬停时按指针位置计算 `rotateX / rotateY`，可选跟随光斑高光与轻微放大，营造纵深感；`reduced-motion` 与触屏设备自动退化为静态卡片。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">3D 倾斜卡片（将鼠标悬停在卡片上移动，观察倾斜与光斑）</div>
  <div style="display:flex;justify-content:center;padding:16px 0 8px;">
    <VaTiltCard :max-tilt="14" :perspective="800" glare :glare-opacity="0.22" zoom style="width:340px;">
      <div style="padding:24px;border:1px solid var(--va-color-border, #e2e8f0);border-radius:16px;background:var(--va-color-surface-soft, #f8fafc);">
        <div style="font-size:12px;font-weight:600;letter-spacing:1px;color:var(--va-accent);">AGENT · 自主执行</div>
        <div style="margin-top:10px;font-size:18px;font-weight:700;">深度代码巡检任务</div>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:var(--vp-c-text-2);">指针划过卡片时，rotateX / rotateY 随位置实时变化，跟随光斑掠过表面。</p>
        <div style="margin-top:14px;font-size:12px;color:var(--vp-c-text-2);">最大倾角 14° · 透视 800px · 光斑 0.22 · 悬停放大 1.02</div>
      </div>
    </VaTiltCard>
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaTiltCard } from "@vuagent/ui";
</script>

<template>
  <VaTiltCard :max-tilt="14" :perspective="800" glare :glare-opacity="0.22" zoom>
    <div style="padding:24px;border-radius:16px;">卡片内容放在默认插槽</div>
  </VaTiltCard>
</template>
```

---

## 6. VaVoiceOrb / VaAgentTeam / VaModelWheel — 插画三件

三件纯 CSS / SVG 插画：`VaVoiceOrb` 语音球以波纹与声浪条呈现 idle / listening / speaking 三态；`VaAgentTeam` 将 agent 名单排成环形悬浮徽标阵；`VaModelWheel` 让模型徽标绕中心缓慢自转。均为纯装饰组件，reduced-motion 下全部降级为静态。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">语音球状态切换 · 当前：{{ orbStateLabel }}（点击按钮切换）</div>
  <div style="display:flex;gap:8px;margin-bottom:24px;">
    <button
      v-for="s in orbStates"
      :key="s.key"
      type="button"
      :style="chipStyle(orbState === s.key)"
      @click="orbState = s.key"
    >{{ s.label }}</button>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:32px;align-items:center;justify-content:space-around;">
    <VaVoiceOrb :state="orbState" :size="112" />
    <VaAgentTeam :agents="teamAgents" :size="180" floating />
    <VaModelWheel :models="wheelModels" :size="200" spinning center-label="多模型路由" />
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { ref } from "vue";
import { VaVoiceOrb, VaAgentTeam, VaModelWheel } from "@vuagent/ui";

const orbState = ref<"idle" | "listening" | "speaking">("listening");

const teamAgents = ref([
  { id: "planner", name: "规划器" },
  { id: "coder", name: "编码器" },
  { id: "tester", name: "测试器" },
]);

const wheelModels = ref([
  { id: "glm", name: "GLM" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "qwen", name: "Qwen" },
]);
</script>

<template>
  <VaVoiceOrb :state="orbState" :size="112" />
  <VaAgentTeam :agents="teamAgents" :size="180" floating />
  <VaModelWheel :models="wheelModels" :size="200" spinning center-label="多模型路由" />
</template>
```

---

## 7. VaSpotlightCard — 聚光卡

VaTiltCard 的静态版：accent 发光描边（`--va-glow-accent`）+ 舞台级深投影 + hover 指针光斑（复用 `useSpotlight`）。发光是静态样式不算动画——`reduced-motion` 下保留发光与投影，仅关闭光斑；触屏（`hover: none`）同样不启用光斑。暗色舞台联动：宿主可把卡面换成 `--va-stage-raised` 抬升面。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">聚光卡（鼠标悬停点亮光斑） · 当前：发光 {{ spotGlow ? "开" : "关" }} / 光斑 {{ spotSpot ? "开" : "关" }} / 投影 e{{ spotElevation }}</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
    <button type="button" :style="chipStyle(spotGlow)" @click="spotGlow = !spotGlow">发光描边</button>
    <button type="button" :style="chipStyle(spotSpot)" @click="spotSpot = !spotSpot">指针光斑</button>
    <button
      v-for="n in spotElevations"
      :key="n"
      type="button"
      :style="chipStyle(spotElevation === n)"
      @click="spotElevation = n"
    >投影 e{{ n }}</button>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:24px;">
    <VaSpotlightCard :glow="spotGlow" :spot="spotSpot" :elevation="spotElevation" style="width:320px;">
      <div style="padding:22px;">
        <div style="font-size:12px;font-weight:600;letter-spacing:1px;color:var(--va-accent);">AGENT · 自主执行</div>
        <div style="margin-top:10px;font-size:17px;font-weight:700;">深度代码巡检任务</div>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:var(--vp-c-text-2);">默认卡面（--va-card）+ accent 发光描边 + 舞台深投影，光斑随指针掠过。</p>
      </div>
    </VaSpotlightCard>
    <div data-theme="dark" style="flex:1;min-width:300px;border-radius:16px;background:var(--va-stage);padding:20px;">
      <div style="font-size:12px;color:var(--va-muted);margin-bottom:12px;">暗色舞台表面（data-theme="dark" 子树）</div>
      <VaSpotlightCard :glow="spotGlow" :spot="spotSpot" :elevation="spotElevation" style="--va-spot-card-bg: var(--va-stage-raised);width:100%;">
        <div style="padding:22px;">
          <div style="font-size:17px;font-weight:700;color:var(--va-ink);">Stage Raised 舞台抬升面</div>
          <p style="margin:8px 0 0;font-size:13px;line-height:1.7;color:var(--va-muted);">宿主经 --va-spot-card-bg 钩子接入舞台表面对，暗色下发光换暖橙派生。</p>
        </div>
      </VaSpotlightCard>
    </div>
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaSpotlightCard } from "@vuagent/ui";
</script>

<template>
  <!-- 默认：发光 + 光斑 + 舞台投影 e4 -->
  <VaSpotlightCard>
    <div style="padding:22px;">卡片内容放在默认插槽</div>
  </VaSpotlightCard>

  <!-- 暗色舞台联动：卡面换 stage 抬升面（组件不强制，由宿主决定） -->
  <VaSpotlightCard style="--va-spot-card-bg: var(--va-stage-raised);">
    <div style="padding:22px;">…</div>
  </VaSpotlightCard>
</template>
```

---

## 8. VaScrimEdge — 边缘渐变 Scrim

方向可配置的渐变遮罩原语：`bottom / top / left / right` 四向线性渐隐，叠在卡片或媒体封面上保证文字可读（宿主容器需 `position:relative`）。颜色缺省取 `--va-scrim` 遮罩色，亮暗主题自适应；厚度与渐变起止点均可调，纯 CSS 无动画。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">媒体封面文字保护 · 当前方向：{{ scrimDirs.find(d => d.key === scrimDirection)?.label }}</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
    <button
      v-for="d in scrimDirs"
      :key="d.key"
      type="button"
      :style="chipStyle(scrimDirection === d.key)"
      @click="scrimDirection = d.key"
    >{{ d.label }}</button>
  </div>
  <div style="position:relative;border-radius:12px;overflow:hidden;height:180px;background:linear-gradient(120deg, var(--va-grad-accent-from), var(--va-grad-accent-to));">
    <div style="position:absolute;top:16px;left:16px;font-size:13px;color:rgba(255,255,255,0.85);">媒体封面 / 卡片底图</div>
    <div style="position:absolute;bottom:16px;left:16px;right:16px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">边缘渐隐的遮罩原语</div>
      <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">scrim 只铺依附边（当前 72px），文字叠在其上始终可读。</p>
    </div>
    <VaScrimEdge :direction="scrimDirection" :height="96" />
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaScrimEdge } from "@vuagent/ui";
</script>

<template>
  <!-- 父级容器需 position:relative（组件为绝对定位覆盖层） -->
  <div style="position:relative;">
    <img src="cover.jpg" alt="" />
    <div style="position:absolute;bottom:16px;left:16px;color:#fff;">标题文字</div>
    <VaScrimEdge direction="bottom" :height="96" />
    <!-- 自定义颜色与渐变起止：<VaScrimEdge direction="top" scrim-color="#000" :height="64" :stops="[20, 100]" /> -->
  </div>
</template>
```

---

## 9. VaGradientBorder — 渐变边框

渐变边框原语：`static` 双色渐变描边（padding-box/border-box 双背景手法）；`running` 态 conic 光环慢速旋转——Agent Ops「运行中」语义，周期缺省走 `--va-dur-loop`。slot 承载内容，组件只画边框层；`reduced-motion` 下光环静止降级为静态渐变。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">渐变边框 · 当前：{{ borderVariants.find(v => v.key === borderVariant)?.label }}</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
    <button
      v-for="v in borderVariants"
      :key="v.key"
      type="button"
      :style="chipStyle(borderVariant === v.key)"
      @click="borderVariant = v.key"
    >{{ v.label }}</button>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:stretch;">
    <VaGradientBorder :variant="borderVariant" :width="1.5" style="flex:1;min-width:280px;">
      <div style="padding:18px;">
        <div style="font-size:12px;font-weight:600;letter-spacing:1px;color:var(--va-accent);">TASK-1092</div>
        <div style="margin-top:8px;font-size:15px;font-weight:700;">发布流水线 · 全量回归</div>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.7;color:var(--vp-c-text-2);">{{ borderVariant === "running" ? "光环慢速旋转 = Agent 正在执行（周期跟随 --va-dur-loop）" : "静态双色描边 = 待命/完成态（accent → info 渐变）" }}</p>
      </div>
    </VaGradientBorder>
    <VaGradientBorder variant="static" :width="1.5" from="var(--va-grad-info-from)" to="var(--va-grad-info-to)" style="flex:1;min-width:280px;">
      <div style="padding:18px;">
        <div style="font-size:12px;font-weight:600;letter-spacing:1px;color:var(--va-info);">冷调变体</div>
        <div style="margin-top:8px;font-size:15px;font-weight:700;">数据通道 · info → success</div>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.7;color:var(--vp-c-text-2);">from / to 换吃 --va-grad-info 族端点，次级强调场景。</p>
      </div>
    </VaGradientBorder>
  </div>
</div>

### 代码示例

```vue
<script setup lang="ts">
import { VaGradientBorder } from "@vuagent/ui";
</script>

<template>
  <!-- 静态双色描边 -->
  <VaGradientBorder variant="static" :width="1.5">
    <div style="padding:18px;">内容放默认插槽，组件只画边框层</div>
  </VaGradientBorder>

  <!-- Agent Ops「运行中」：conic 光环慢速旋转，reduced-motion 自动静止 -->
  <VaGradientBorder variant="running" :speed="2200">
    <div style="padding:18px;">运行中的任务卡</div>
  </VaGradientBorder>
</template>
```

---
