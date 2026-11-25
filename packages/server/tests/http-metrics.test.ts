/**
 * TASK-097：HTTP/SSE/进程指标扩展
 * - histogram：桶分布渲染（bucket 累计 / +Inf / _sum / _count）+ 标签分组确定性；
 * - 路由模板归一（防标签基数爆炸）：参数化段 → :id，未知路由原样；
 * - SSE 连接/事件指标（sse-response metrics 回调 → registry）；
 * - 进程内存采集器（抓取时快照）+ eventloop 采样 gauge。
 */
import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "../src/core/metrics-registry.js";
import { createSSEResponse } from "../src/core/sse-response.js";
import { createHarnessServer } from "../src/server.js";

const LOCAL_ORIGIN = "http://localhost:5173";

describe("MetricsRegistry histogram（TASK-097）", () => {
  it("桶累计分布 + _sum/_count 渲染；标签分组各自独立", () => {
    const registry = new MetricsRegistry();
    registry.observeHistogram("vuagent_http_request_duration_ms", 30, { route: "/api/chat" });
    registry.observeHistogram("vuagent_http_request_duration_ms", 600, { route: "/api/chat" });
    registry.observeHistogram("vuagent_http_request_duration_ms", 9000, { route: "/api/sessions/:id" });

    const out = registry.renderPrometheus();
    expect(out).toContain("# TYPE vuagent_http_request_duration_ms histogram");
    // 路由 /api/chat：30ms 落 le="50"，600ms 落 le="1000" → count 级累计 2
    expect(out).toContain('vuagent_http_request_duration_ms_bucket{route="/api/chat",le="50"} 1');
    expect(out).toContain('vuagent_http_request_duration_ms_bucket{route="/api/chat",le="1000"} 2');
    expect(out).toContain('vuagent_http_request_duration_ms_bucket{route="/api/chat",le="+Inf"} 2');
    expect(out).toContain('vuagent_http_request_duration_ms_count{route="/api/chat"} 2');
    // 9000 超出全部边界 → 最末桶（le="5000"）兜底
    expect(out).toContain('vuagent_http_request_duration_ms_bucket{route="/api/sessions/:id",le="5000"} 1');
    expect(out).toContain('vuagent_http_request_duration_ms_sum{route="/api/chat"} 630');
    // 渲染确定性：两次逐字节一致
    expect(registry.renderPrometheus()).toBe(out);
  });

  it("无标签 histogram 渲染（无 {} 形态）", () => {
    const registry = new MetricsRegistry();
    registry.observeHistogram("vuagent_http_request_duration_ms", 7);
    const out = registry.renderPrometheus();
    expect(out).toContain('vuagent_http_request_duration_ms_bucket{le="10"} 1');
    expect(out).toContain("vuagent_http_request_duration_ms_sum 7");
  });

  it("采集器型 gauge：renderPrometheus 时采样（注册即输出）", () => {
    const registry = new MetricsRegistry();
    let snapshot = 42;
    registry.setGaugeCollector("vuagent_process_heap_bytes", () => [{ value: snapshot }]);
    const first = registry.renderPrometheus();
    expect(first).toContain("# TYPE vuagent_process_heap_bytes gauge");
    expect(first).toContain("vuagent_process_heap_bytes 42");
    snapshot = 100;
    expect(registry.renderPrometheus()).toContain("vuagent_process_heap_bytes 100");
  });

  it("decGauge：配对递减且负值钳 0", () => {
    const registry = new MetricsRegistry();
    registry.incCounter("vuagent_sse_active_connections");
    registry.incCounter("vuagent_sse_active_connections");
    registry.decGauge("vuagent_sse_active_connections");
    expect(registry.renderPrometheus()).toContain("vuagent_sse_active_connections 1");
    registry.decGauge("vuagent_sse_active_connections");
    registry.decGauge("vuagent_sse_active_connections"); // 超减钳 0
    expect(registry.renderPrometheus()).toContain("vuagent_sse_active_connections 0");
  });
});

describe("SSE 指标回调（TASK-097）", () => {
  it("onOpen/onClose/onEvent 经回调流出（连接与事件计数）", async () => {
    let opens = 0;
    let closes = 0;
    const eventTypes: string[] = [];
    const res = createSSEResponse({
      heartbeatMs: 0,
      metrics: {
        onOpen: () => void ++opens,
        onClose: () => void ++closes,
        onEvent: (type) => eventTypes.push(type),
      },
      attach: (pump) => {
        pump({ type: "text_delta", messageId: "m", delta: "x" } as never);
        pump("[DONE]");
        return { unsubscribe: () => {} };
      },
    });
    await res.text();
    expect(opens).toBe(1);
    expect(closes).toBe(1);
    expect(eventTypes).toEqual(["text_delta", "done"]);
  });

  it("未提供 metrics 时零回调（零开销路径）", async () => {
    const res = createSSEResponse({
      heartbeatMs: 0,
      attach: (pump) => {
        pump({ type: "text_delta", messageId: "m", delta: "x" } as never);
        pump("[DONE]");
        return { unsubscribe: () => {} };
      },
    });
    await res.text();
    expect(res.status).toBe(200);
  });
});

describe("/metrics 路由接线（TASK-097）", () => {
  it("请求后 http 指标出现且 route 为模板形（不含具体 id）；进程内存 gauge 就绪", async () => {
    const { app, workspaceRepo } = createHarnessServer({ dbPath: ":memory:" });
    const ws = await workspaceRepo.create({ name: "w", rootPath: "/tmp/va-metrics", permission: "read-write" });
    // 走真实存在的路由：列表（无参）+ 文件树（参数化 :id 段）
    await app.request("/api/workspaces", { headers: { Origin: LOCAL_ORIGIN } });
    await app.request(`/api/workspaces/${ws.id}/files`, { headers: { Origin: LOCAL_ORIGIN } });

    const metricsRes = await app.request("/metrics");
    expect(metricsRes.status).toBe(200);
    const text = await metricsRes.text();
    expect(text).toContain('vuagent_http_requests_total{method="GET",route="/api/workspaces",status="200"}');
    expect(text).toContain(
      'vuagent_http_requests_total{method="GET",route="/api/workspaces/:id/files",status="200"}'
    );
    expect(text).not.toContain(ws.id); // 模板归一：具体 id 不进标签
    expect(text).toContain('vuagent_http_request_duration_ms_count{route="/api/workspaces"} 1');
    expect(text).toContain("vuagent_process_heap_bytes");
    expect(text).toContain("vuagent_process_rss_bytes");
  });
});
