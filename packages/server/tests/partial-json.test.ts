import { describe, it, expect } from "vitest";
import { parsePartialJson } from "../src/core/stream-orchestrator.js";

describe("StreamOrchestrator - parsePartialJson", () => {
  it("should parse complete JSON", () => {
    expect(parsePartialJson('{"title": "test", "count": 42}')).toEqual({
      title: "test",
      count: 42,
    });
  });

  it("should repair unclosed string value", () => {
    expect(parsePartialJson('{"title": "hell')).toEqual({
      title: "hell",
    });
  });

  it("should repair trailing comma and unclosed object", () => {
    expect(parsePartialJson('{"a": 1, "b": 2,')).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("should repair nested incomplete structure", () => {
    expect(parsePartialJson('{"user": {"name": "Alice", "tags": ["a", "b')).toEqual({
      user: {
        name: "Alice",
        tags: ["a", "b"],
      },
    });
  });

  it("should return null for empty or non-object prefix", () => {
    expect(parsePartialJson("")).toBeNull();
    expect(parsePartialJson("hello world")).toBeNull();
  });
});
