import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/**
 * 场景① 云运维 Copilot：集群健康巡检（只读，仿真数据源）
 * 强化：CPU/内存趋势序列 + SLO 水位 + 3 Pod 拓扑；模型可在此基础上继续调用 ops_list_incidents 深挖。
 */
export const OpsInspectClusterTool: HarnessTool = {
  name: "ops_inspect_cluster",
  description: "检查云原生集群中指定微服务的健康度、Pod 实例状态、资源趋势与 SLO 水位（内置仿真数据源）。若发现异常，可继续调用 ops_list_incidents 查看关联事件时间线。",
  parameters: Type.Object({
    serviceName: Type.String({
      description: "要巡检的微服务名称，例如 order-service、payment-service、auth-service",
    }),
    namespace: Type.Optional(
      Type.String({ description: "所属 Kubernetes 命名空间，缺省为 production" })
    ),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const serviceName = String(ctx.args.serviceName || "order-service");
    const namespace = String(ctx.args.namespace || "production");

    return {
      rendered: true,
      component: "ui_cluster_health",
      props: {
        serviceName,
        namespace,
        cluster: "k8s-prod-cluster-01",
        version: "v1.28.4",
        status: "degraded",
        cpuUsage: "78%",
        memoryUsage: "94%",
        cpuSeries: [52, 55, 61, 58, 66, 71, 69, 74, 78, 76, 81, 78],
        memSeries: [71, 73, 76, 78, 82, 85, 88, 90, 92, 93, 94, 94],
        slo: {
          availability: "99.21% / 目标 99.90%",
          errorBudget: "剩余 18%（7 天窗口）",
          p99Latency: "412ms（目标 < 300ms）",
        },
        replicaSummary: "2/2 Ready (High Load)",
        pods: [
          {
            name: `${serviceName}-79df4b-m48x1`,
            status: "running",
            restarts: 0,
            node: "worker-node-us-east-1a",
            cpu: "36%",
            mem: "420 MB",
          },
          {
            name: `${serviceName}-79df4b-q99k2`,
            status: "warning",
            restarts: 3,
            node: "worker-node-us-east-1b",
            cpu: "42%",
            mem: "542 MB (Threshold 94%)",
          },
          {
            name: `${serviceName}-79df4b-r71p9`,
            status: "warning",
            restarts: 1,
            node: "worker-node-us-east-1c",
            cpu: "44%",
            mem: "538 MB (Threshold 94%)",
          },
        ],
        alerts: [
          "【高危告警】实例内存水位持续超过 90% 警戒阈值，存在 OOMKilled 风险",
          "【负载建议】建议执行副本水平扩容 (scale) 至 4~5 个实例以分流洪峰流量",
          "【关联线索】可调用 ops_list_incidents 查看该服务近 24h 关联事件时间线",
        ],
      },
    };
  },
};

/**
 * 场景① 云运维 Copilot：关联事件时间线（只读）
 * 返回 ui_incident_timeline 卡片——与巡检卡形成「巡检 → 深挖」多轮工具链。
 */
export const OpsListIncidentsTool: HarnessTool = {
  name: "ops_list_incidents",
  description: "查询指定微服务近 24 小时的关联事件与告警时间线（内置仿真事件源）",
  parameters: Type.Object({
    serviceName: Type.String({ description: "微服务名称" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const serviceName = String(ctx.args.serviceName || "order-service");
    return {
      rendered: true,
      component: "ui_incident_timeline",
      props: {
        serviceName,
        incidents: [
          {
            id: "INC-2418",
            severity: "critical",
            title: "内存水位突破 90% 警戒线",
            time: "10:12",
            status: "firing",
            detail: "q99k2 / r71p9 两个实例连续 6 个采样点超阈值，JVM 老年代占用 97%",
          },
          {
            id: "INC-2417",
            severity: "warning",
            title: "P99 延迟超标（412ms > 300ms）",
            time: "09:47",
            status: "firing",
            detail: "下单接口 createOrder 尾延迟抬升，与 GC 停顿时间相关性 0.82",
          },
          {
            id: "INC-2415",
            severity: "info",
            title: "配置变更：connectionPool 20→25",
            time: "08:30",
            status: "resolved",
            detail: "发布单 PL-1042，变更人：ops-oncall；变更后连接等待队列清零",
          },
          {
            id: "INC-2411",
            severity: "warning",
            title: "营销大促流量预告",
            time: "07:00",
            status: "watching",
            detail: "12:00 大促开场，预计流量峰值 +180%，当前副本数不足以承接",
          },
        ],
      },
    };
  },
};

/**
 * 场景① 云运维 Copilot：微服务实例副本扩容（高危写操作，触发安全引擎 HITL 审批拦截）
 */
export const OpsScaleReplicasTool: HarnessTool = {
  name: "ops_scale_replicas",
  description: "调整生产环境微服务的 Pod 实例副本数（高危写操作，触发人工安全审批）",
  parameters: Type.Object({
    serviceName: Type.String({ description: "要调整的目标微服务名称，例如 order-service" }),
    targetReplicas: Type.Integer({ description: "目标副本实例数 (1-20)", minimum: 1, maximum: 20 }),
    reason: Type.Optional(Type.String({ description: "扩容申请原因或故障工单说明" })),
  }),
  riskLevel: "high",
  requiresApproval: true,
  writesWorkspace: false,
  execute: async (ctx) => {
    const serviceName = String(ctx.args.serviceName || "order-service");
    const targetReplicas = Number(ctx.args.targetReplicas) || 5;
    const reason = ctx.args.reason ? String(ctx.args.reason) : "业务洪峰流量紧急横向扩容";

    return {
      rendered: true,
      component: "ui_canary_deploy",
      props: {
        serviceName,
        currentReplicas: 2,
        targetReplicas,
        status: "completed",
        strategy: "RollingUpdate",
        reason,
        metrics: { cpuBefore: "78%", cpuAfter: "31%", memBefore: "94%", memAfter: "38%" },
        probes: {
          liveness: `Passed (${targetReplicas}/${targetReplicas})`,
          readiness: `Passed (${targetReplicas}/${targetReplicas})`,
        },
        timeline: [
          { time: "T+0s", event: "人工审批通过，向 Kubernetes API 发起 Deployment 伸缩声明" },
          { time: "T+2s", event: `调度器分配新 Pod 节点，拉取镜像并启动实例 (2 -> ${targetReplicas})` },
          { time: "T+4s", event: "HTTP GET /healthz 存活与就绪探针检查全部通过" },
          { time: "T+5s", event: "Ingress 负载均衡平滑接入新实例流量，内存警戒解除" },
        ],
      },
    };
  },
};

/**
 * 场景① 扩展：生产部署（演示 L2 表单采集 + L1 审批的完整链路）
 * 链路：模型先用 ui_form 收集部署参数（环境/副本数/部署令牌 secret），
 * 参数齐全后调用本工具——高危写操作触发审批门，批准后返回金丝雀部署结果卡。
 */
export const OpsDeployServiceTool: HarnessTool = {
  name: "ops_deploy_service",
  description:
    "将微服务部署到目标环境（高危写操作，触发人工安全审批）。" +
    "调用本工具前必须先调用 ui_form 工具，按下方参数要求渲染表单向用户收集部署参数：" +
    "environment 适合 select（选项 staging=预发 / production=生产）、replicas 适合 number（建议默认 3、单位个）、" +
    "deployToken 是敏感凭证（务必标记 secret 字段，用户输入不会进入对话）。" +
    "三个参数收集齐全前禁止调用本工具；deployToken 若为 secret:// 引用原样透传即可。",
  parameters: Type.Object({
    serviceName: Type.Optional(
      Type.String({ description: "要部署的微服务名称，缺省 order-service" })
    ),
    environment: Type.Union([Type.Literal("staging"), Type.Literal("production")], {
      description: "目标部署环境（应来自 ui_form 表单收集结果）",
    }),
    replicas: Type.Integer({ description: "部署副本数（来自表单收集）", minimum: 1, maximum: 20 }),
    deployToken: Type.String({ description: "部署令牌或 secret 引用（来自表单收集）" }),
    reason: Type.Optional(Type.String({ description: "部署说明" })),
  }),
  riskLevel: "high",
  requiresApproval: true,
  writesWorkspace: false,
  execute: async (ctx) => {
    const serviceName = String(ctx.args.serviceName || "order-service");
    const environment = String(ctx.args.environment || "production");
    const replicas = Number(ctx.args.replicas) || 3;
    const token = String(ctx.args.deployToken || "");
    // secret 引用只展示占位形态，永不回显明文（真实部署由执行点在 secret store 还原）
    const tokenMasked = token.startsWith("secret://") ? "（引用已接收，执行点还原）" : "（已接收）";
    const reason = ctx.args.reason ? String(ctx.args.reason) : "版本例行发布";

    return {
      rendered: true,
      component: "ui_canary_deploy",
      props: {
        serviceName,
        currentReplicas: environment === "production" ? 2 : 1,
        targetReplicas: replicas,
        status: "completed",
        strategy: "RollingUpdate",
        reason: `${reason} · 环境 ${environment} · 部署令牌${tokenMasked}`,
        metrics: { cpuBefore: "45%", cpuAfter: "46%", memBefore: "61%", memAfter: "62%" },
        probes: {
          liveness: `Passed (${replicas}/${replicas})`,
          readiness: `Passed (${replicas}/${replicas})`,
        },
        timeline: [
          { time: "T+0s", event: "人工审批通过，部署参数经表单采集齐备，向集群发起 Deployment 声明" },
          { time: "T+2s", event: `调度器在 ${environment} 环境拉起 ${replicas} 个实例` },
          { time: "T+4s", event: "存活与就绪探针检查全部通过" },
          { time: "T+5s", event: "Ingress 接入新实例流量，部署完成" },
        ],
      },
    };
  },
};

export const opsTools = [OpsInspectClusterTool, OpsListIncidentsTool, OpsScaleReplicasTool, OpsDeployServiceTool];
