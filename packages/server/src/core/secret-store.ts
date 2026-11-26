/**
 * TASK-092（实施方案 TASK-E）：敏感值通道（设计文档 §5）的 secret store。
 *
 * 表单收集密码/token/私钥时，明文**永不进入模型上下文**（摘要与附录都不进），
 * 也不进轨迹台账与会话落库：
 * - server 路由边界校验通过后，secret 字段值从 envelope.values 剥离，
 *   真实值落入本 store，values 原位替换为 { ref, masked } 占位；
 * - 模型后续通过 ref 引用（如 bash 环境变量插值）——「知道值已提供、可以引用，
 *   但始终见不到明文」；执行点还原（ref → 明文）是后续任务的消费侧接线，
 *   本任务先落地 store 契约与真实值的唯一归属。
 *
 * 宿主注入点：createHarnessServer({ secretStore }) 可替换实现；
 * 缺省为进程内存形态（单机语义与 ActionHub 内存挂起对齐——进程重启即失效，
 * ref 随之不可解，与「协程不复活」的诚实语义一致）。
 * Redis 形态（多副本共享/重启可还原）留作后续任务尾巴：接口已是异步友好
 * （Promise|值 联合返回），接入时实现同一 SecretStore 契约即可。
 */

import type { TSchema } from "@sinclair/typebox";
import { maskSecretValue } from "./result-digest.js";

/** secret 值占位形态（ref 引用 + masked 展示；模型可见的全部信息） */
export interface SecretPlaceholder {
  ref: string;
  masked: string;
}

export interface SecretPutMeta {
  /** 产生该敏感值的挂起动作（ref 确定性来源之一） */
  actionId: string;
  /** 表单字段 key */
  field: string;
  /** 发起挂起的会话（排障与后续 TTL 归属用） */
  sessionId?: string;
}

/**
 * 敏感值存储契约（宿主注入点）。
 * put 幂等：同 actionId+field 重复写入返回同一 ref（重复提交/幂等重放
 * 不制造第二份拷贝、不改变已落账决策的哈希形态）。
 */
export interface SecretStore {
  put(value: string, meta: SecretPutMeta): Promise<SecretPlaceholder> | SecretPlaceholder;
  /** 按 ref 还原明文（执行点消费，后续任务接线；不存在的 ref 返回 undefined） */
  resolve(ref: string): Promise<string | undefined> | string | undefined;
  /**
   * 按挂起 actionId 清理全部引用（可选）：供宿主在「轮次终结」时机调用——
   * 注意不能挂在决策到达（settle）：工具执行在 resume 之后，届时仍需按 ref
   * 还原明文。宿主自定义 store 不实现时跳过清理（明文由宿主自管）。
   */
  purgeByAction?(actionId: string): void;
}

/** ref 确定性推导：secret://<actionId>/<field>（同键重放哈希稳定，幂等契约前提） */
export function secretRefOf(actionId: string, field: string): string {
  return `secret://${encodeURIComponent(actionId)}/${encodeURIComponent(field)}`;
}

/**
 * 从已校验的 submit values 中剥离 secret 字段（路由边界唯一剥离点）：
 * 真实值写入 store，原位替换为 { ref, masked } 占位——剥离后的 values 才会进入
 * 唤醒协程的 ActionResponse、幂等落账、摘要/附录、轨迹台账与会话卡片，
 * 四处统一不见明文（设计文档 §8「secret 泄露」行）。
 *
 * ref 按 actionId+field 确定性推导：同键重放剥离结果逐字节一致，
 * 幂等哈希（hashEnvelope）对重放保持稳定。
 */
export async function stripSecretFieldValues(
  values: Record<string, unknown>,
  resultSchema: TSchema | undefined,
  store: SecretStore,
  meta: { actionId: string; sessionId?: string }
): Promise<{ values: Record<string, unknown>; stripped: string[] }> {
  const properties = (resultSchema as { properties?: Record<string, { secret?: boolean }> } | undefined)
    ?.properties;
  if (!properties) return { values, stripped: [] };
  const stripped: string[] = [];
  const out: Record<string, unknown> = { ...values };
  for (const [key, prop] of Object.entries(properties)) {
    if (prop?.secret !== true) continue;
    const raw = out[key];
    if (typeof raw !== "string" || raw.length === 0) continue;
    out[key] = await store.put(raw, { actionId: meta.actionId, field: key, sessionId: meta.sessionId });
    stripped.push(key);
  }
  return { values: out, stripped };
}

/** 进程内存形态（缺省实现）：真实值只活在本进程内存，不落任何持久层 */
export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  put(value: string, meta: SecretPutMeta): SecretPlaceholder {
    const ref = secretRefOf(meta.actionId, meta.field);
    // first-write-wins（评审 R1）：异体重放被 422 拒绝前可能已触发 strip/put——
    // 被拒明文不得覆盖（毒化）已落账决策对应 ref 的还原值
    if (!this.values.has(ref)) this.values.set(ref, value);
    return { ref, masked: maskSecretValue(this.values.get(ref) as string) };
  }

  resolve(ref: string): string | undefined {
    return this.values.get(ref);
  }

  /** 交互终态清理：移除该挂起下的全部明文引用（评审 N-1，前缀匹配） */
  purgeByAction(actionId: string): void {
    const prefix = `secret://${encodeURIComponent(actionId)}/`;
    for (const ref of this.values.keys()) {
      if (ref.startsWith(prefix)) this.values.delete(ref);
    }
  }

  /** 测试/排障观察口：当前持有的 ref 数量（不暴露明文） */
  get size(): number {
    return this.values.size;
  }
}
