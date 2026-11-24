<script setup lang="ts">
import { VaApprovalCard } from "@vuagent/ui";

const detail = `{
  "tool": "ops_scale_replicas",
  "service": "order-service",
  "targetReplicas": 5,
  "currentReplicas": 2,
  "reason": "营销大促洪峰流量横向扩容"
}`;

const steps = [
  {
    num: "1",
    title: "挂起",
    desc: "工具声明 requiresApproval: true——模型发起调用后，执行协程在工具边界挂起，SSE 推送 action_suspended。",
  },
  {
    num: "2",
    title: "人工决策",
    desc: "宿主界面弹出 VaApprovalCard：风险徽章 + 参数预览 + 决策回传。批准或驳回，都在用户手里。",
  },
  {
    num: "3",
    title: "唤醒执行",
    desc: "POST /api/action/:id 回传决策，挂起协程恢复执行；驳回则按拒绝语义干净终止，不留悬挂操作。",
  },
];
</script>

<template>
  <section class="lh-hitl">
    <div class="lh-hitl__inner">
      <div class="lh-hitl__copy">
        <h2 class="lh-sec-title">危险操作，先过人这一关</h2>
        <p class="lh-sec-sub">
          Agent Ops 的核心不是让 agent 更快，而是让高风险动作可控。HITL（Human-in-the-Loop）
          审批是 vuagent 的一等公民：服务端协程级挂起、界面级审批卡、决策回传唤醒——三段全部内建。
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
        <p class="lh-hitl__note">下面就是真实的 VaApprovalCard 组件——不是截图，你现在就可以和它交互。</p>
      </div>
      <div class="lh-hitl__card">
        <VaApprovalCard
          title="生产变更安全审批：ops_scale_replicas 申请执行"
          :detail="detail"
          risk="high"
        />
        <p class="lh-hitl__card-note">order-service 副本扩容 · 等待工程师拍板</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lh-hitl {
  background: var(--va-ground-dark, #141311);
}
.lh-hitl__inner {
  max-width: 1180px;
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
  color: var(--ink-inverse, #f0eee9);
}
.lh-sec-sub {
  margin: 14px 0 0;
  font-size: 15px;
  color: rgba(240, 238, 233, 0.66);
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
  background: var(--va-accent, #c2410c); color: #ffffff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.lh-hitl__step-title { font-size: 16px; font-weight: 700; color: var(--ink-inverse, #f0eee9); }
.lh-hitl__step-desc { font-size: 13px; color: rgba(240, 238, 233, 0.6); line-height: 1.75; margin: 5px 0 0; }
.lh-hitl__note {
  margin: 26px 0 0;
  font-size: 12px;
  color: #e8925e;
  letter-spacing: 0.04em;
}
.lh-hitl__card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 480px;
  justify-self: center;
  width: 100%;
}
.lh-hitl__card-note {
  font-size: 11px;
  color: rgba(240, 238, 233, 0.45);
  text-align: center;
  font-family: var(--va-font-mono, ui-monospace, monospace);
}
@media (max-width: 960px) {
  .lh-hitl__inner { grid-template-columns: 1fr; gap: 36px; padding: 56px 20px; }
}
</style>
