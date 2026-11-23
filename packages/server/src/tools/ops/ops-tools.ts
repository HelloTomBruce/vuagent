import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

/**
 * 云原生运维场景工具：集群健康巡检（只读操作，模拟数据源）
 * 模型命中该工具后，返回结构化的高质感集群健康指标，前端匹配 ui_cluster_health 组件渲染。
 */
export const OpsInspectClusterTool: HarnessTool = {
  name: "ops_inspect_cluster",
  description: "检查云原生集群中指定微服务的健康度、Pod 实例状态与资源消耗（内置仿真集群数据源）",
  parameters: Type.Object({
    serviceName: Type.String({
      description: "要巡检的微服务名称，例如 order-service、payment-service、auth-service",
    }),
    namespace: Type.Optional(
      Type.String({
        description: "所属 Kubernetes 命名空间，缺省为 production",
        default: "production",
      })
    ),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const serviceName = String(ctx.args.serviceName || "order-service");
    const namespace = String(ctx.args.namespace || "production");

    // 高仿真模拟业务数据：包含资源水位告警与 Pod 拓扑
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
        ],
        alerts: [
          "【高危告警】实例内存水位持续超过 90% 警戒阈值，存在 OOMKilled 风险",
          "【负载建议】建议执行副本水平扩容 (scale) 至 4~5 个实例以分流洪峰流量",
        ],
      },
    };
  },
};

/**
 * 云原生运维场景工具：微服务实例副本扩容（高危写操作，触发安全引擎 HITL 审批拦截）
 * 执行成功后返回扩容部署状态与探针健康检查，前端匹配 ui_canary_deploy 组件渲染。
 */
export const OpsScaleReplicasTool: HarnessTool = {
  name: "ops_scale_replicas",
  description: "调整生产环境微服务的 Pod 实例副本数（高危写操作，触发人工安全审批）",
  parameters: Type.Object({
    serviceName: Type.String({
      description: "要调整的目标微服务名称，例如 order-service",
    }),
    targetReplicas: Type.Integer({
      description: "目标副本实例数 (1-20)",
      minimum: 1,
      maximum: 20,
    }),
    reason: Type.Optional(
      Type.String({
        description: "扩容申请原因或故障工单说明",
      })
    ),
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
        metrics: {
          cpuBefore: "78%",
          cpuAfter: "31%",
          memBefore: "94%",
          memAfter: "38%",
        },
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

export const OpsSceneTools = [OpsInspectClusterTool, OpsScaleReplicasTool];
