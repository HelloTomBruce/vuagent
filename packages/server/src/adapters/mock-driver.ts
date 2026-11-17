import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "./model-driver.js";

export type MockStep =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

export interface MockScript {
  steps: MockStep[][]; // 每个 turn 对应一个 steps 序列
}

/**
 * 确定性仿真驱动 (MockDriver)
 * 用于驱动严格的单元测试与断言校验
 */
export class MockDriver implements IModelDriver {
  private turnCursor = 0;

  constructor(private scripts: MockScript = { steps: [] }) {}

  setScript(scripts: MockScript) {
    this.scripts = scripts;
    this.turnCursor = 0;
  }

  async *generateStream(_req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    const currentTurnSteps = this.scripts.steps[this.turnCursor] || [];
    this.turnCursor++;

    for (const step of currentTurnSteps) {
      if (step.type === "text") {
        // 模拟流式拆分 token
        const chunks = step.text.match(/.{1,4}/g) || [step.text];
        for (const chunk of chunks) {
          yield {
            type: "text_delta",
            text: chunk,
          };
        }
      } else if (step.type === "tool_call") {
        const jsonStr = JSON.stringify(step.arguments);
        // 先产出头部
        yield {
          type: "tool_call_delta",
          toolCall: {
            index: 0,
            id: step.id,
            name: step.name,
            argumentsDelta: "",
          },
        };

        // 模拟逐段吐出 JSON 字符
        const slices = jsonStr.match(/.{1,6}/g) || [jsonStr];
        for (const slice of slices) {
          yield {
            type: "tool_call_delta",
            toolCall: {
              index: 0,
              argumentsDelta: slice,
            },
          };
        }
      }
    }

    yield {
      type: "usage",
      usage: {
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
      },
    };

    yield { type: "done" };
  }
}
