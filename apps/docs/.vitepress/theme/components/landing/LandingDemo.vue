<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";

/**
 * 演示视频注册表：视频就绪后把 src 置为 withBase("/videos/<name>.mp4")
 * （文件放 apps/docs/public/videos/），占位自动切换为可播放视频。
 */
const SLOTS = [
  {
    id: "hero",
    label: "总宣传片",
    title: "vuagent · 60 秒总览",
    desc: "从「文本流」到「组件流」：三场景蒙太奇一次看完。",
    poster: withBase("/img/landing/host-cloudops-real.jpg"),
    video: null as string | null,
    featured: true,
  },
  {
    id: "cloudops",
    label: "① 云运维 Copilot",
    title: "巡检 → 事件深挖 → 审批扩容，一气呵成",
    desc: "只读巡检返回带趋势与 SLO 的健康卡；扩容属于高危写操作，安全引擎自动挂起，批准后执行链唤醒。",
    poster: withBase("/img/landing/host-cloudops-real.jpg"),
    video: null as string | null,
    featured: false,
  },
  {
    id: "analysis",
    label: "② 数据分析副驾",
    title: "计划先行，图表即结果",
    desc: "agent 先把分析计划亮出来供核对，执行后 KPI 趋势与渠道构成渲染成图表卡，报告卡上可直接下钻明细。",
    poster: withBase("/img/landing/host-analysis-real.jpg"),
    video: null as string | null,
    featured: false,
  },
  {
    id: "tasks",
    label: "③ 后台任务管家",
    title: "任务在跑，日志在滚",
    desc: "耗时任务交给 agent 后台执行：收件箱统一管理状态演进，ANSI 终端卡实时跟踪日志流。",
    poster: withBase("/img/landing/host-tasks-real.jpg"),
    video: null as string | null,
    featured: false,
  },
];

const featured = SLOTS[0];
const scenes = SLOTS.filter((s) => !s.featured);

const active = ref(scenes[0].id);
const scene = computed(() => scenes.find((s) => s.id === active.value)!);

function onArrowKey(event: KeyboardEvent) {
  const ids = scenes.map((s) => s.id);
  const current = ids.indexOf(active.value);
  let next = current;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % ids.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + ids.length) % ids.length;
  else return;
  event.preventDefault();
  active.value = ids[next];
  document.getElementById(`lh-demo-tab-${ids[next]}`)?.focus();
}
</script>

<template>
  <section class="lh-demo">
    <div class="lh-demo__inner">
      <h2 class="lh-sec-title">真实业务系统 × 嵌入式 Copilot</h2>
      <p class="lh-sec-sub">
        三个真实接入形态的案例：已有业务系统保持原样，右侧 Copilot 嵌入后获得巡检、审批与任务管理能力。
        以下为案例实拍——不是概念图。
      </p>

      <!-- 总宣传片位 -->
      <div class="lh-demo__featured">
        <video
          v-if="featured.video"
          class="lh-demo__frame"
          :src="featured.video"
          :poster="featured.poster"
          controls
          muted
          playsinline
          preload="metadata"
        ></video>
        <div v-else class="lh-demo__frame lh-demo__frame--placeholder">
          <img class="lh-demo__poster" :src="featured.poster" :alt="featured.title" />
          <div class="lh-demo__bar">
            <span class="lh-demo__bar-title">{{ featured.title }}</span>
            <span class="lh-demo__bar-note">视频后期上线 · 先看下方逐场景实拍</span>
          </div>
        </div>
      </div>

      <!-- 逐场景 -->
      <div class="lh-demo__tabs" role="tablist" aria-label="选择演示场景" @keydown="onArrowKey">
        <button
          v-for="s in scenes"
          :id="`lh-demo-tab-${s.id}`"
          :key="s.id"
          type="button"
          class="lh-demo__tab"
          :class="{ 'lh-demo__tab--active': s.id === active }"
          role="tab"
          :aria-selected="s.id === active"
          :aria-controls="`lh-demo-panel-${s.id}`"
          :tabindex="s.id === active ? 0 : -1"
          @click="active = s.id"
        >
          {{ s.label }}
        </button>
      </div>

      <div
        :id="`lh-demo-panel-${scene.id}`"
        class="lh-demo__stage"
        role="tabpanel"
        :aria-label="scene.label"
      >
        <video
          v-if="scene.video"
          class="lh-demo__frame"
          :src="scene.video"
          :poster="scene.poster"
          controls
          muted
          playsinline
          preload="metadata"
        ></video>
        <div v-else class="lh-demo__frame lh-demo__frame--placeholder">
          <img class="lh-demo__poster" :src="scene.poster" :alt="scene.title" />
          <div class="lh-demo__bar">
            <span class="lh-demo__bar-title">{{ scene.title }}</span>
            <span class="lh-demo__bar-links">
              <a
                href="https://github.com/HelloTomBruce/vuagent/tree/main/examples/agent-gallery"
                target="_blank"
                rel="noreferrer"
              >案例源码 ↗</a>
              <a :href="withBase('/guide/getting-started')">接入指南</a>
            </span>
          </div>
        </div>
        <p class="lh-demo__desc">{{ scene.desc }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-demo { background: #141311; }
.lh-demo__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 76px 32px;
}
.lh-sec-title {
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  color: #f0eee9;
}
.lh-sec-sub {
  margin: 12px 0 0;
  font-size: 16px;
  color: rgba(240, 238, 233, 0.72);
  max-width: 780px;
  line-height: 1.8;
}
.lh-demo__featured { margin-top: 32px; }

.lh-demo__tabs { display: flex; gap: 8px; margin-top: 40px; flex-wrap: wrap; }
.lh-demo__tab {
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(240, 238, 233, 0.18);
  background: #1c1a17;
  color: rgba(240, 238, 233, 0.72);
  cursor: pointer;
  transition: all 0.15s;
}
.lh-demo__tab:hover { border-color: #e8925e; color: #e8925e; }
.lh-demo__tab--active {
  background: var(--va-accent, #c2410c);
  border-color: var(--va-accent, #c2410c);
  color: #ffffff;
}
.lh-demo__tab:focus-visible {
  outline: 2px solid #e8925e;
  outline-offset: 2px;
}

.lh-demo__stage { margin-top: 20px; }
.lh-demo__frame {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(232, 146, 94, 0.28);
  box-shadow: 0 0 0 1px rgba(194, 65, 12, 0.1), 0 30px 90px rgba(0, 0, 0, 0.5);
  background: #1c1a17;
  display: block;
}
.lh-demo__frame--placeholder { position: relative; }
.lh-demo__poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
  filter: saturate(0.94);
}
.lh-demo__bar {
  position: absolute;
  inset: auto 0 0 0;
  padding: 16px 22px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: linear-gradient(180deg, rgba(20, 19, 17, 0) 0%, rgba(20, 19, 17, 0.82) 55%);
}
.lh-demo__bar-title { color: #f0eee9; font-size: 16px; font-weight: 600; }
.lh-demo__bar-note { color: rgba(240, 238, 233, 0.6); font-size: 12px; }
.lh-demo__bar-links { margin-left: auto; display: flex; gap: 16px; }
.lh-demo__bar-links a {
  color: #e8925e;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.lh-demo__bar-links a:hover { text-decoration: underline; }
.lh-demo__desc {
  margin: 16px 2px 0;
  font-size: 14px;
  color: rgba(240, 238, 233, 0.72);
  line-height: 1.8;
}
</style>
