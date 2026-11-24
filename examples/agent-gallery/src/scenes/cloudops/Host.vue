<script setup lang="ts">
import { Server, ShieldCheck, Zap } from "lucide-vue-next";

const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

const services = [
  { name: "order-service", desc: "核心交易与订单创建微服务", status: "warning", replicas: "2/2", cpu: "78%", mem: "94%（警戒）" },
  { name: "payment-service", desc: "银行渠道网关与支付清结算", status: "healthy", replicas: "4/4", cpu: "32%", mem: "45%" },
  { name: "auth-service", desc: "统一身份认证与 JWT Token 签发", status: "healthy", replicas: "3/3", cpu: "24%", mem: "38%" },
  { name: "inventory-service", desc: "分布式库存扣减与仓储调度", status: "healthy", replicas: "2/2", cpu: "41%", mem: "56%" },
];
</script>

<template>
  <div>
    <div class="host-banner">
      <h1>线上微服务实时监控（K8s Production）</h1>
      <p>只读巡检返回集群健康卡片；副本扩容属于高危写操作，会触发安全引擎审批挂起（HITL）。</p>
    </div>

    <div class="host-grid">
      <div
        v-for="s in services"
        :key="s.name"
        class="svc"
        :class="{ 'svc--warn': s.status === 'warning' }"
      >
        <div class="svc__head">
          <span class="svc__name"><Server :size="13" /> {{ s.name }}</span>
          <span class="svc__badge" :class="s.status === 'warning' ? 'svc__badge--warn' : 'svc__badge--ok'">
            {{ s.status === "warning" ? "Degraded" : "Healthy" }}
          </span>
        </div>
        <p class="svc__desc">{{ s.desc }}</p>
        <div class="svc__stats">
          <span>Pod {{ s.replicas }}</span>
          <span>CPU {{ s.cpu }}</span>
          <span :class="{ 'text-danger': s.status === 'warning' }">MEM {{ s.mem }}</span>
        </div>
        <button class="svc__btn" @click="emit('quick', `检查 ${s.name} 的集群健康状况并输出分析`)">
          <ShieldCheck :size="12" /> 调用 Copilot 巡检
        </button>
      </div>
    </div>

    <div class="host-hint">
      <Zap :size="13" />
      <span>试试右侧「扩容至 5 副本」：安全引擎会挂起任务，等你在审批卡上拍板。</span>
    </div>
  </div>
</template>

<style scoped>
.host-banner { margin-bottom: 14px; }
.host-banner h1 { font-size: 16px; margin: 0 0 4px; }
.host-banner p { font-size: 12px; color: var(--gv-muted); margin: 0; }

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.svc {
  background: #ffffff;
  border: 1px solid var(--gv-border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.svc--warn { border-color: #fca5a5; background: #fffafa; }

.svc__head { display: flex; align-items: center; justify-content: space-between; }
.svc__name { display: inline-flex; align-items: center; gap: 5px; font-family: var(--va-font-mono, monospace); font-size: 12px; font-weight: 600; }
.svc__badge { font-size: 10px; padding: 1px 7px; border-radius: 999px; }
.svc__badge--ok { background: #dcfce7; color: #166534; }
.svc__badge--warn { background: #fee2e2; color: #991b1b; }
.svc__desc { font-size: 11px; color: var(--gv-muted); margin: 0; min-height: 30px; line-height: 1.5; }
.svc__stats { display: flex; gap: 10px; font-size: 11px; color: var(--gv-ink); font-family: var(--va-font-mono, monospace); }
.text-danger { color: #dc2626; }

.svc__btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--gv-border); background: #f8fafc;
  color: var(--gv-ink); font-size: 11px; padding: 5px 10px;
  border-radius: 6px; cursor: pointer; width: fit-content;
}
.svc__btn:hover { border-color: var(--gv-accent); color: var(--gv-accent); }

.host-hint {
  margin-top: 16px;
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--gv-muted);
  background: #fff8f1; border: 1px dashed #f0cdb2;
  padding: 8px 12px; border-radius: 8px;
}
</style>
