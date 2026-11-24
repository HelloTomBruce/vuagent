<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";

/**
 * 演示视频注册表：视频就绪后把 src 置为
 * withBase("/videos/<name>.mp4")（文件放 apps/docs/public/videos/）即可上线，
 * 未就绪时展示设计化占位（真实页面截帧 + 「视频制作中」角标）。
 */
const SCENES = [
  {
    id: "cloudops",
    label: "① 云运维 Copilot",
    title: "巡检 → 事件深挖 → 审批扩容，一气呵成",
    desc: "只读巡检返回带趋势与 SLO 的健康卡；扩容属于高危写操作，安全引擎自动挂起，批准后执行链唤醒。",
    poster: withBase("/img/landing/host-cloudops-real.jpg"),
    video: null as string | null,
  },
  {
    id: "analysis",
    label: "② 数据分析副驾",
    title: "计划先行，图表即结果",
    desc: "agent 先把分析计划亮出来供核对，执行后 KPI 趋势与渠道构成渲染成图表卡，报告卡上可直接下钻明细。",
    poster: withBase("/img/landing/host-analysis-real.jpg"),
    video: null as string | null,
  },
  {
    id: "tasks",
    label: "③ 后台任务管家",
    title: "任务在跑，日志在滚",
    desc: "耗时任务交给 agent 后台执行：收件箱统一管理状态演进，ANSI 终端卡实时跟踪日志流。",
    poster: withBase("/img/landing/host-tasks-real.jpg"),
    video: null as string | null,
  },
];

const active = ref(SCENES[0].id);
const scene = computed(() => SCENES.find((s) => s.id === active.value)!);
</script>

<template>
  <section class="lh-demo">
    <div class="lh-demo__inner">
      <h2 class="lh-sec-title">真实业务系统 × 嵌入式 Copilot</h2>
      <p class="lh-sec-sub">
        三个真实接入形态的案例：已有业务系统保持原样，右侧 Copilot 嵌入后获得巡检、审批与任务管理能力。
        以下为案例实拍——不是概念图。
      </p>

      <div class="lh-demo__tabs" role="tablist">
        <button
          v-for="s in SCENES"
          :key="s.id"
          type="button"
          class="lh-demo__tab"
          :class="{ 'lh-demo__tab--active': s.id === active }"
          role="tab"
          @click="active = s.id"
        >
          {{ s.label }}
        </button>
      </div>

      <div class="lh-demo__stage">
        <video
          v-if="scene.video"
          class="lh-demo__video"
          :src="scene.video"
          :poster="scene.poster"
          controls
          muted
          playsinline
          preload="metadata"
        ></video>
        <div v-else class="lh-demo__placeholder">
          <img class="lh-demo__poster" :src="scene.poster" :alt="scene.title" />
          <div class="lh-demo__placeholder-bar">
            <span class="lh-demo__play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
            </span>
            <span class="lh-demo__placeholder-text">{{ scene.title }}</span>
            <span class="lh-demo__badge">演示视频制作中</span>
          </div>
        </div>

        <p class="lh-demo__desc">{{ scene.desc }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-demo { background: var(--va-ground-light, #f7f6f2); }
.lh-demo__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 72px 32px;
}
.lh-sec-title {
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  color: var(--va-ink, #1a1917);
}
.lh-sec-sub {
  margin: 12px 0 0;
  font-size: 16px;
  color: var(--va-muted, #6f6d66);
  max-width: 780px;
  line-height: 1.8;
}
.lh-demo__tabs { display: flex; gap: 8px; margin-top: 30px; flex-wrap: wrap; }
.lh-demo__tab {
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  background: var(--va-card, #ffffff);
  color: var(--va-muted, #6f6d66);
  cursor: pointer;
  transition: all 0.15s;
}
.lh-demo__tab:hover { border-color: var(--va-accent, #c2410c); color: var(--va-accent, #c2410c); }
.lh-demo__tab--active {
  background: var(--va-accent, #c2410c);
  border-color: var(--va-accent, #c2410c);
  color: #ffffff;
}
.lh-demo__stage { margin-top: 20px; }
.lh-demo__video,
.lh-demo__placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--va-edge, rgba(26, 25, 23, 0.12));
  box-shadow: 0 24px 70px rgba(26, 25, 23, 0.14);
  background: var(--va-ink, #1a1917);
  display: block;
}
.lh-demo__placeholder { position: relative; }
.lh-demo__poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: saturate(0.92);
}
.lh-demo__placeholder-bar {
  position: absolute;
  inset: auto 0 0 0;
  padding: 18px 22px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(180deg, rgba(20, 19, 17, 0) 0%, rgba(20, 19, 17, 0.78) 60%);
}
.lh-demo__play {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--va-accent, #c2410c); color: #ffffff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 18px rgba(194, 65, 12, 0.4);
}
.lh-demo__placeholder-text { color: #f0eee9; font-size: 16px; font-weight: 600; }
.lh-demo__badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #f0eee9;
  border: 1px solid rgba(240, 238, 233, 0.3);
  border-radius: 999px;
  padding: 3px 10px;
  letter-spacing: 0.04em;
}
.lh-demo__desc {
  margin: 16px 2px 0;
  font-size: 14px;
  color: var(--va-muted, #6f6d66);
  line-height: 1.8;
}
@media (prefers-reduced-motion: reduce) {
  .lh-demo__tab, .lh-demo__tab:hover { transition: none; }
}
</style>
