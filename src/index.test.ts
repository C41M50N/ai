import { describe, expect, it } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import { createAI } from "./index.js";

describe("createAI", () => {
  const makeClient = () =>
    createAI({
      providers: {
        fake: () => (id: string) => ({ id }) as never,
      },
      models: {
        fast: { provider: "fake", id: "fake-fast" },
        smart: { provider: "fake", id: "fake-smart", costs: { input: 2.5, output: 10 } },
      },
    });

  it("exposes the configured model aliases", () => {
    const ai = makeClient();
    expect([...ai.models].sort()).toEqual(["fast", "smart"]);
  });

  it("freezes the models array", () => {
    const ai = makeClient();
    expect(Object.isFrozen(ai.models)).toBe(true);
  });

  it("exposes a generate function", () => {
    const ai = makeClient();
    expect(typeof ai.generate).toBe("function");
  });

  it("forwards standardized reasoning and tracks usage costs", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "Hello" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      },
    });
    const ai = createAI({
      providers: {
        fake: () => () => model,
      },
      models: {
        smart: { provider: "fake", id: "fake-smart", costs: { input: 2.5, output: 10 } },
      },
    });

    const result = await ai.generate({ model: "smart", prompt: "Hello", reasoning: "high" });

    expect(model.doGenerateCalls[0]?.reasoning).toBe("high");
    expect(result.data).toBe("Hello");
    expect(result.metadata).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      inputCostUsd: 0.00025,
      outputCostUsd: 0.0002,
      totalCostUsd: 0.00045,
    });
  });
});
