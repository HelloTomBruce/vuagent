/**
 * @vuagent/ui - HITL 动作提交客户端
 * 供 VaAgentRenderer 提交用户审批/交互决策；HTTP 非 2xx 一律抛错（由调用方转 error 事件）。
 */

import { setFormFieldErrors } from "./form-errors";

/**
 * 提交互信封到服务端。apiBaseUrl-only 宿主路径（不经 useAgentChat）下，
 * server 422 + fieldErrors（§4.2 重填闭环）写入 form-errors 响应式通道就地回显
 * ——评审 R3 修复：此前该路径的校验错误被静默丢弃，用户完全看不到失败原因。
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
    if (res.status === 422) {
      const body = (await res.json().catch(() => null)) as {
        fieldErrors?: Record<string, string>;
      } | null;
      if (body?.fieldErrors && Object.keys(body.fieldErrors).length > 0) {
        setFormFieldErrors(toolCallId, body.fieldErrors);
        throw new Error(
          `表单校验未通过：${Object.entries(body.fieldErrors)
            .map(([k, v]) => `${k}（${v}）`)
            .join("、")}`
        );
      }
    }
    throw new Error(`[VaAgentRenderer] action submit failed: HTTP ${res.status}`);
  }
}
