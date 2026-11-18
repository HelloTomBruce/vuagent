/**
 * @vuagent/ui - HITL 动作提交客户端
 * 供 VaAgentRenderer 提交用户审批/交互决策；HTTP 非 2xx 一律抛错（由调用方转 error 事件）。
 */

export async function postAgentAction(
  apiBaseUrl: string,
  toolCallId: string,
  payload: unknown,
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/action/${toolCallId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) {
    throw new Error(`[VaAgentRenderer] action submit failed: HTTP ${res.status}`);
  }
}
