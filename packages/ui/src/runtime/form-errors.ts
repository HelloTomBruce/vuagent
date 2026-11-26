/**
 * @vuagent/ui - 表单 fieldErrors 通道（TASK-092，设计文档 §4.2）
 *
 * 校验失败不是终态而是新的输入：本地预校验失败与 server 422（ENVELOPE_VALUES_INVALID
 * 携带 fieldErrors）都不唤醒 agent——错误就地回显在表单卡片上，用户修正后重提。
 *
 * 为什么用模块级 reactive Map 而不是挂到 MessageBlock：MessageBlock 是同步卡口
 * （check-protocol-sync）语料内的契约类型，交互期错误是纯前端瞬时状态，不应进
 * 契约面。propAdapter 在 VaAgentRenderer 的 activeProps computed 内执行，读取本
 * Map 即注册响应依赖——set/clear 自动驱动表单错误回显重渲染。
 *
 * 生命周期：提交前 clear（清上次错误）→ 校验失败 set → 提交成功/取消 clear；
 * clearMessages 整体清空防泄漏。
 */

import { reactive } from "vue";

export const formFieldErrors = reactive(new Map<string, Record<string, string>>());

export function setFormFieldErrors(toolCallId: string, fieldErrors: Record<string, string>): void {
  formFieldErrors.set(toolCallId, { ...fieldErrors });
}

export function clearFormFieldErrors(toolCallId: string): void {
  formFieldErrors.delete(toolCallId);
}

export function clearAllFormFieldErrors(): void {
  formFieldErrors.clear();
}
