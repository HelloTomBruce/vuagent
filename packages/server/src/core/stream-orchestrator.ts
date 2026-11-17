import type { HarnessStreamEvent } from "./types.js";

/**
 * 容错流式 Partial JSON 解析器
 * 用于在模型逐 Token 输出 JSON 参数的流式阶段，容错修补未闭合的括号与引号，提取合法字段
 */
export function parsePartialJson(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;

  // 尝试直接原生解析
  try {
    const res = JSON.parse(trimmed);
    if (typeof res === "object" && res !== null && !Array.isArray(res)) {
      return res as Record<string, unknown>;
    }
  } catch {
    // 预期内的语法不完整，继续进入容错修补逻辑
  }

  // 容错修补：扫描未闭合的结构
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  let validPrefix = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      validPrefix += char;
    } else {
      if (char === '"') {
        inString = true;
        validPrefix += char;
      } else if (char === "{" || char === "[") {
        stack.push(char);
        validPrefix += char;
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
          validPrefix += char;
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
          validPrefix += char;
        }
      } else {
        validPrefix += char;
      }
    }
  }

  // 修补尾部
  let repaired = validPrefix.trim();

  // 移除尾部悬空逗号或冒号 (如: {"a": 1, -> {"a": 1)
  repaired = repaired.replace(/[:,]\s*$/, "");

  // 如果字符串处于打开状态，补齐闭合引号
  if (inString) {
    repaired += '"';
  }

  // 补齐未闭合的括号
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === "{") repaired += "}";
    else if (top === "[") repaired += "]";
  }

  try {
    const res = JSON.parse(repaired);
    if (typeof res === "object" && res !== null && !Array.isArray(res)) {
      return res as Record<string, unknown>;
    }
  } catch {
    // 依然无法修复则返回 null
  }

  return null;
}

/**
 * SSE 流式序列化器
 */
export class StreamOrchestrator {
  /**
   * 格式化为标准 SSE 格式: "data: {...}\n\n"
   */
  static formatSSE(event: HarnessStreamEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  /**
   * 格式化结束流标记
   */
  static formatDone(): string {
    return `data: [DONE]\n\n`;
  }
}
