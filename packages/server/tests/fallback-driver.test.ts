import { describe, it, expect } from "vitest";
import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";
import { ClassifiedModelError } from "../src/adapters/resilience.js";
import { FallbackChainDriver, type FallbackAttempt, type FallbackNotice } from "../src/core/fallback-driver.js";

function scriptDriver(
  chunks: ModelStreamChunk[],
  behavior?: "throw_after_yield" | "throw_immediately",
  errorClass: ConstructorParameters<typeof ClassifiedModelError>[1] = "rate_limit",
  capturedRequests: ModelDriverRequest[] = []
): IModelDriver {
  return {
    async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
      capturedRequests.push(req);
      if (behavior === "throw_immediately") {
        throw new ClassifiedModelError(`boom (${errorClass})`, errorClass, 429);
      }
      for (const chunk of chunks) {
        yield chunk;
      }
      if (behavior === "throw_after_yield") {
        throw new ClassifiedModelError(`boom (${errorClass})`, errorClass, 429);
      }
    },
  };
}

function textChunk(text: string): ModelStreamChunk {
  return { type: "text_delta", text };
}

function makeChain(attempts: FallbackAttempt[], notices: FallbackNotice[] = []) {
  return new FallbackChainDriver(attempts, (n) => notices.push(n));
}

const baseReq: ModelDriverRequest = { model: "primary-model", messages: [] };

describe("FallbackChainDriver（模型降级链）", () => {
  it("主档案流开始前失败（限流类）→ 按序切换备用档案，正常完成", async () => {
    const primary = scriptDriver([], "throw_immediately", "rate_limit");
    const backup = scriptDriver([textChunk("from backup"), { type: "done" }]);
    const chain = makeChain([
      { name: "P", model: "p-model", driver: primary },
      { name: "B", model: "b-model", driver: backup },
    ]);

    const out: ModelStreamChunk[] = [];
    for await (const chunk of chain.generateStream(baseReq)) out.push(chunk);

    expect(out.map((c) => c.type)).toContain("text_delta");
    expect(out[out.length - 1].type).toBe("done");
  });

  it("流已开始吐字后失败 → 不透明降级（诚实重试边界），错误原样上抛", async () => {
    const primary = scriptDriver([textChunk("partial")], "throw_after_yield");
    const backup = scriptDriver([textChunk("should-not-run")]);
    const chain = makeChain([
      { name: "P", driver: primary },
      { name: "B", driver: backup },
    ]);

    const chunks: ModelStreamChunk[] = [];
    await expect(async () => {
      for await (const chunk of chain.generateStream(baseReq)) chunks.push(chunk);
    }).rejects.toThrow(ClassifiedModelError);

    // 备用档案未被调用
    expect(chunks.map((c) => (c as { text?: string }).text)).toContain("partial");
    expect(chunks.map((c) => (c as { text?: string }).text)).not.toContain("should-not-run");
  });

  it("auth / bad_request / context_overflow 类错误不参与降级", async () => {
    for (const errorClass of ["auth", "bad_request", "context_overflow"] as const) {
      const primary = scriptDriver([], "throw_immediately", errorClass);
      const backup = scriptDriver([textChunk("nope")]);
      const chain = makeChain([
        { name: "P", driver: primary },
        { name: "B", driver: backup },
      ]);
      await expect(async () => {
        for await (const _ of chain.generateStream(baseReq)) {
          // drain
        }
      }).rejects.toThrow(ClassifiedModelError);
    }
  });

  it("全部档案失败 → 上抛最后一个错误；onFallback 记录每次切换", async () => {
    const notices: FallbackNotice[] = [];
    const chain = makeChain(
      [
        { name: "A", driver: scriptDriver([], "throw_immediately", "rate_limit") },
        { name: "B", driver: scriptDriver([], "throw_immediately", "server") },
        { name: "C", driver: scriptDriver([], "throw_immediately", "network") },
      ],
      notices
    );

    await expect(async () => {
      for await (const _ of chain.generateStream(baseReq)) {
        // drain
      }
    }).rejects.toThrow(/network/);

    expect(notices.map((n) => `${n.from}->${n.to}`)).toEqual(["A->B", "B->C"]);
    expect(notices[0].errorClass).toBe("rate_limit");
    expect(typeof notices[0].at).toBe("number");
  });

  it("降级后使用备用档案自己的模型名（model 覆盖）", async () => {
    const captured: ModelDriverRequest[] = [];
    const backup = scriptDriver([textChunk("ok")], undefined, "rate_limit", captured);
    const primary = scriptDriver([], "throw_immediately");
    const chain = makeChain([
      { name: "P", model: "p-model", driver: primary },
      { name: "B", model: "b-model", driver: backup },
    ]);
    for await (const _ of chain.generateStream({ ...baseReq, messages: [{ role: "user", content: "hi" }] })) {
      // drain
    }
    expect(captured[0].model).toBe("b-model");
    expect(captured[0].messages).toHaveLength(1);
  });

  it("单档案链等价直连（无降级路径）", async () => {
    const only = scriptDriver([textChunk("solo"), { type: "done" }]);
    const chain = makeChain([{ name: "P", driver: only }]);
    const out: ModelStreamChunk[] = [];
    for await (const chunk of chain.generateStream(baseReq)) out.push(chunk);
    expect(out).toHaveLength(2);
  });

  it("空链抛出明确错误", async () => {
    const chain = makeChain([]);
    await expect(async () => {
      for await (const _ of chain.generateStream(baseReq)) {
        // drain
      }
    }).rejects.toThrow(/至少一个/);
  });
});
