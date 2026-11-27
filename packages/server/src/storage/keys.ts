/**
 * 存储层键与 LIKE 模式的单一构造点（0.7.0 W2 评审 O1）。
 *
 * 此前同一套键格式在 session.repository / checkpoint.repository / CLI prune 里
 * 各写一遍（`${sessionId}:${turnId}:${cpId}`），而 LIKE 前缀查询的转义更容易写错
 * ——prune 曾把追加的 `%` 一起转义，导致级联删除静默失效。所有键与模式都必须
 * 从这里取，不允许调用点手搓。
 */

/** 轮次行键：`${sessionId}:${turnId}` */
export const turnRowKey = (sessionId: string, turnId: string): string => `${sessionId}:${turnId}`;

/** 轮次行前缀：`${sessionId}:` */
export const turnRowPrefix = (sessionId: string): string => `${sessionId}:`;

/** checkpoint 行键：`${sessionId}:${turnId}:${checkpointId}` */
export const checkpointKey = (sessionId: string, turnId: string, checkpointId: string): string =>
  `${sessionId}:${turnId}:${checkpointId}`;

/** checkpoint 前缀：会话级（turnId 省略）或轮次级 */
export const checkpointPrefix = (sessionId: string, turnId?: string): string =>
  turnId ? `${sessionId}:${turnId}:` : `${sessionId}:`;

/** LIKE 元字符转义（配合 `ESCAPE '\'` 使用）：只转义字面量部分 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/**
 * 前缀 → LIKE 模式：**先转义前缀里的元字符，再追加通配符**。
 * 顺序写反（把 `%` 一起转义）会让 `LIKE` 退化成精确匹配——prune 的级联删除
 * 就是这样静默失效的（评审 C2）。所有前缀查询必须走这里。
 */
export function likePrefix(prefix: string): string {
  return `${escapeLikePattern(prefix)}%`;
}
