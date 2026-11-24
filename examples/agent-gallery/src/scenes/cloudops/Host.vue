<script setup lang="ts">
import { Clock, Database, GitBranch, RefreshCw, Search, Server } from "lucide-vue-next";

const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

interface ServiceRow {
  name: string;
  status: "healthy" | "degraded";
  version: string;
  replicas: string;
  qps: string;
  p99: string;
  errRate: string;
  mem: string;
}

const services: ServiceRow[] = [
  { name: "order-service", status: "degraded", version: "v2.14.0", replicas: "2/2", qps: "4,820", p99: "412ms", errRate: "0.42%", mem: "94%" },
  { name: "payment-service", status: "healthy", version: "v1.9.2", replicas: "4/4", qps: "1,250", p99: "186ms", errRate: "0.03%", mem: "45%" },
  { name: "auth-service", status: "healthy", version: "v3.1.0", replicas: "3/3", qps: "8,900", p99: "64ms", errRate: "0.01%", mem: "38%" },
  { name: "inventory-service", status: "healthy", version: "v2.5.1", replicas: "2/2", qps: "2,100", p99: "158ms", errRate: "0.08%", mem: "56%" },
  { name: "search-service", status: "healthy", version: "v1.4.7", replicas: "6/6", qps: "5,640", p99: "89ms", errRate: "0.05%", mem: "51%" },
  { name: "notify-service", status: "healthy", version: "v1.0.9", replicas: "2/2", qps: "640", p99: "132ms", errRate: "0.02%", mem: "29%" },
];

const alerts = [
  { id: "INC-2418", level: "P1", name: "order-service", title: "内存水位突破 90% 警戒线", time: "10:12", firing: true },
  { id: "INC-2417", level: "P2", name: "order-service", title: "P99 延迟超标（412ms > 300ms）", time: "09:47", firing: true },
  { id: "INC-2415", level: "P3", name: "auth-service", title: "配置变更完成 connectionPool 20→25", time: "08:30", firing: false },
];

const deployments = [
  { service: "order-service", version: "v2.14.0", time: "今天 09:12", note: "滚动更新 · 已就绪" },
  { service: "auth-service", version: "v3.1.0", time: "昨天 16:40", note: "滚动更新 · 已就绪" },
  { service: "search-service", version: "v1.4.7", time: "昨天 10:05", note: "蓝绿切换 · 已回收" },
];

function inspect(name: string) {
  emit("quick", `请调用 ops_inspect_cluster 工具巡检 ${name} 的生产集群健康度并展示状态卡片`);
}

function analyzeAlert(a: (typeof alerts)[number]) {
  emit("quick", `请调用 ops_list_incidents 工具查看 ${a.name} 的关联事件时间线，并分析告警 ${a.id}（${a.title}）的根因与影响面`);
}
</script>

<template>
  <div>
    <!-- 工具栏 -->
    <div class="h-toolbar">
      <span class="h-toolbar__title"><Server :size="14" style="vertical-align: -2px" /> 服务目录</span>
      <span class="h-pill">环境 <b>Production · us-east-1</b></span>
      <span class="h-pill"><Clock :size="11" /> 近 1 小时</span>
      <span class="h-pill"><RefreshCw :size="11" /> 自动刷新 30s</span>
      <span class="h-spacer" />
      <span class="h-pill">最近更新 <b>12s 前</b></span>
    </div>

    <!-- 概览指标 -->
    <div class="h-strip">
      <div class="h-strip__item"><span class="h-strip__label">受监控服务</span><span class="h-strip__val">24</span><span class="h-strip__sub">跨 3 个命名空间</span></div>
      <div class="h-strip__item"><span class="h-strip__label">运行正常</span><span class="h-strip__val">21</span><span class="h-strip__sub">较昨日 +1</span></div>
      <div class="h-strip__item"><span class="h-strip__label">活跃告警</span><span class="h-strip__val" style="color: #dc2626">3</span><span class="h-strip__sub">P1 ×1 · P2 ×1 · P3 ×1</span></div>
      <div class="h-strip__item"><span class="h-strip__label">错误预算消耗</span><span class="h-strip__val" style="color: #b45309">82%</span><span class="h-strip__sub">7 天窗口 · order-service 主导</span></div>
      <div class="h-strip__item"><span class="h-strip__label">今日发布</span><span class="h-strip__val">2</span><span class="h-strip__sub">滚动更新 全部就绪</span></div>
    </div>

    <div class="h-grid2">
      <!-- 服务目录表 -->
      <div class="h-panel">
        <div class="h-panel__head">
          <span><Search :size="12" style="vertical-align: -1px" /> 服务实例</span>
          <span class="h-panel__count">24 个服务 · 按负载排序</span>
        </div>
        <div style="overflow-x: auto">
          <table class="h-table">
            <thead>
              <tr><th>服务</th><th>状态</th><th>版本</th><th>副本</th><th>QPS</th><th>P99</th><th>错误率</th><th>内存</th><th></th></tr>
            </thead>
            <tbody>
              <tr
                v-for="s in services"
                :key="s.name"
                :style="s.status === 'degraded' ? 'background:#fffafa' : ''"
                @click="inspect(s.name)"
              >
                <td>{{ s.name }}</td>
                <td><span class="bdg" :class="s.status === 'degraded' ? 'bdg--err' : 'bdg--ok'">{{ s.status === "degraded" ? "Degraded" : "Healthy" }}</span></td>
                <td>{{ s.version }}</td>
                <td>{{ s.replicas }}</td>
                <td>{{ s.qps }}</td>
                <td :style="s.p99.startsWith('4') ? 'color:#dc2626;font-weight:600' : ''">{{ s.p99 }}</td>
                <td>{{ s.errRate }}</td>
                <td :style="s.mem === '94%' ? 'color:#dc2626;font-weight:600' : ''">{{ s.mem }}</td>
                <td><span style="color: var(--gv-accent); font-weight: 600">巡检 →</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 右列：活跃告警 + 最近发布 -->
      <div style="display: flex; flex-direction: column; gap: 12px">
        <div class="h-panel">
          <div class="h-panel__head">
            <span>活跃告警</span>
            <span class="h-panel__count">3 条未确认</span>
          </div>
          <div class="h-panel__body" style="display: flex; flex-direction: column; gap: 8px; padding-top: 12px">
            <div
              v-for="a in alerts"
              :key="a.id"
              style="border: 1px solid var(--gv-border); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 5px"
            >
              <div style="display: flex; align-items: center; gap: 6px">
                <span class="bdg" :class="a.level === 'P1' ? 'bdg--err' : a.level === 'P2' ? 'bdg--warn' : 'bdg--muted'">{{ a.level }}</span>
                <span style="font-size: 12px; font-weight: 600">{{ a.title }}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--gv-muted); font-family: var(--va-font-mono, monospace)">
                <span>{{ a.id }}</span><span>{{ a.name }}</span><span>{{ a.time }}</span>
                <span v-if="a.firing" class="bdg bdg--err">触发中</span><span v-else class="bdg bdg--muted">已恢复</span>
              </div>
              <button class="h-btn" style="width: fit-content" @click="analyzeAlert(a)">Copilot 分析此告警</button>
            </div>
          </div>
        </div>

        <div class="h-panel">
          <div class="h-panel__head">
            <span><GitBranch :size="12" style="vertical-align: -1px" /> 最近发布</span>
            <span class="h-panel__count">近 7 天</span>
          </div>
          <div class="h-panel__body" style="display: flex; flex-direction: column; gap: 8px">
            <div v-for="d in deployments" :key="d.service + d.version" style="display: flex; align-items: center; gap: 8px; font-size: 11px">
              <Database :size="12" style="color: var(--gv-muted)" />
              <span style="font-family: var(--va-font-mono, monospace); font-weight: 600">{{ d.service }}</span>
              <span class="bdg bdg--info">{{ d.version }}</span>
              <span style="color: var(--gv-muted); margin-left: auto; font-size: 10px">{{ d.time }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
