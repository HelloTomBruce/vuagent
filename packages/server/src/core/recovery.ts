import type { SessionRepository } from "../storage/repositories/session.repository.js";

/**
 * 进程重启恢复（TASK-049）：扫描所有会话中遗留 status==="running" 的轮次，
 * 诚实标记为 error/process_restart（对齐 harness-core FileTaskStore 语义）。
 * 已完成的 checkpoints 与 content 原样保留——崩溃前落库的进度可查。
 *
 * 不做「假装可恢复续跑」：provider 流已死，诚实呈现中断事实。
 * 服务启动时调用（fire-and-forget）；导出纯函数供测试直接驱动。
 */
export interface RecoveredTurn {
  sessionId: string;
  turnId: string;
  /** 该轮已落库的 checkpoint 数（崩溃前完成进度） */
  checkpointCount: number;
}

export async function recoverInterruptedTurns(
  sessionRepo: SessionRepository
): Promise<RecoveredTurn[]> {
  const sessions = await sessionRepo.list();
  const recovered: RecoveredTurn[] = [];

  for (const session of sessions) {
    let modified = false;
    for (const turn of session.turns ?? []) {
      if (turn.status === "running") {
        turn.status = "error";
        turn.errorMessage = "process_restart";
        // R8：协议枚举落成活路径——历史恢复呈现「服务重启中断」徽标
        turn.abortedReason = "process_restart";
        if (turn.completedAt === undefined) {
          turn.completedAt = Date.now();
        }
        recovered.push({
          sessionId: session.id,
          turnId: turn.id,
          checkpointCount: Array.isArray(turn.checkpoints) ? turn.checkpoints.length : 0,
        });
        modified = true;
      }
    }
    if (modified) {
      await sessionRepo.update(session.id, { turns: session.turns });
    }
  }

  return recovered;
}
