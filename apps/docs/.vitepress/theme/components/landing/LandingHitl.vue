<script setup lang="ts">
import { VaApprovalCard, VaForm } from "@vuagent/ui";
import { withBase } from "vitepress";

const detail = `{
  "tool": "ops_scale_replicas",
  "service": "order-service",
  "targetReplicas": 5,
  "currentReplicas": 2,
  "reason": "营销大促洪峰流量横向扩容"
}`;

const steps = [
  {
    num: "L1",
    title: "审批决策",
    desc: "高风险操作先过人这一关：VaApprovalCard 呈现风险与参数预览，批准放行、驳回以非错误摘要唤醒——模型明确「这是用户的决定」，不重试轰炸。",
  },
  {
    num: "L2",
    title: "表单采集",
    desc: "ui_form 六型字段挂起等填写：必填缺失就地回显修正，secret 字段打码为占位引用——模型精确理解每个值，却永远看不到令牌明文。",
  },
  {
    num: "L3",
    title: "协作计划",
    desc: "agent_plan 进入协作态：编辑步骤以 patch 增量暂存（不唤醒模型），点「确认」合并为最终计划——Agent 按用户改完的计划继续跑。",
  },
];

const formFields = [
  { key: "env", label: "部署环境", type: "select", required: true, options: [
    { value: "production", label: "生产（8C16G）" },
    { value: "staging", label: "预发（4C8G）" },
  ] },
  { key: "replicas", label: "副本数", type: "number", unit: "个", default: 2 },
  { key: "apiKey", label: "访问令牌", type: "text", secret: true, required: true },
];
</script>

<template>
  <section class="lh-hitl">
    <div class="lh-hitl__inner">
      <div class="lh-hitl__copy">
        <h2 class="lh-sec-title">可交互组件：Agent 不只输出，还会提问</h2>
        <p class="lh-sec-sub">
          HITL 在 vuagent 是从协议到像素的一条链：挂起是 wire protocol 的一等事件，回传统一走
          交互信封（submit / cancel / patch），决策端点、表单卡、协作计划、断线重连后的卡片重建
          全部内建——多数框架只给挂起原语，界面留给宿主自己写。三级能力，注册时声明即得。
        </p>
        <div class="lh-hitl__steps">
          <div v-for="s in steps" :key="s.num" class="lh-hitl__step">
            <span class="lh-hitl__num">{{ s.num }}</span>
            <div>
              <div class="lh-hitl__step-title">{{ s.title }}</div>
              <p class="lh-hitl__step-desc">{{ s.desc }}</p>
            </div>
          </div>
        </div>
        <p class="lh-hitl__note">右侧是真实的 VaApprovalCard 与 VaForm——不是截图，你现在就可以和它们交互。</p>
      </div>
      <div class="lh-hitl__card">
        <VaApprovalCard
          title="生产变更安全审批：ops_scale_replicas 申请执行"
          :detail="detail"
          risk="high"
        />
        <VaForm
          title="创建生产部署 — 参数采集"
          description="示例：agent 向你收集部署参数（演示数据，不会真实提交）"
          :fields="formFields"
          submit-label="提交部署参数"
        />
        <div class="lh-hitl__ctas">
          <a class="lh-hitl__cta lh-hitl__cta--primary" :href="withBase('/guide/interactive-components')">了解可交互组件</a>
          <a
            class="lh-hitl__cta"
            href="https://github.com/HelloTomBruce/vuagent/tree/main/examples/agent-gallery"
            target="_blank"
            rel="noreferrer"
          >查看 examples 源码 ↗</a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-hitl {
  /* 亮暗双主题：本地变量承载版块配色，.dark 祖先类翻转（与 tokens.css 的 .dark 块同机制） */
  --_bg: #f7f5f1;
  --_panel: #ffffff;
  --_ink: #1a1917;
  --_accent: #c2410c;
}
.dark .lh-hitl {
  --_bg: #141311;
  --_panel: #1c1a17;
  --_ink: #f0eee9;
  --_accent: #e8925e;
}
.lh-hitl {
  background: var(--_bg);
  border-top: 1px solid color-mix(in srgb, var(--_ink) 8%, transparent);
}
.lh-hitl__inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 76px 32px;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 56px;
  align-items: center;
}
.lh-sec-title {
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  color: var(--_ink);
}
.lh-sec-sub {
  margin: 14px 0 0;
  font-size: 15px;
  color: color-mix(in srgb, var(--_ink) 74%, transparent);
  line-height: 1.85;
}
.lh-hitl__steps {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 32px;
}
.lh-hitl__step { display: flex; gap: 14px; align-items: flex-start; }
.lh-hitl__num {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--va-accent, #c2410c); color: var(--va-accent-contrast, #ffffff);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; flex-shrink: 0;
}
.lh-hitl__step-title { font-size: 16px; font-weight: 700; color: var(--_ink); }
.lh-hitl__step-desc { font-size: 13px; color: color-mix(in srgb, var(--_ink) 74%, transparent); line-height: 1.75; margin: 5px 0 0; }
.lh-hitl__note {
  margin: 26px 0 0;
  font-size: 12px;
  color: var(--_accent);
  letter-spacing: 0.03em;
}
.lh-hitl__card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 480px;
  justify-self: center;
  width: 100%;
}
.lh-hitl__ctas { display: flex; gap: 12px; flex-wrap: wrap; }
.lh-hitl__cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--_ink) 22%, transparent);
  color: var(--_ink);
  text-decoration: none;
  transition: all 0.15s;
}
.lh-hitl__cta:hover { border-color: var(--_accent); color: var(--_accent); }
.lh-hitl__cta--primary {
  background: var(--va-accent, #c2410c);
  border-color: var(--va-accent, #c2410c);
  color: var(--va-accent-contrast, #ffffff);
}
.lh-hitl__cta--primary:hover { background: var(--va-accent-hover, #d9531e); color: var(--va-accent-contrast, #ffffff); }
@media (max-width: 960px) {
  .lh-hitl__inner { grid-template-columns: 1fr; gap: 36px; padding: 56px 20px; }
}
</style>
