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

  it("forwards abort signals", async () => {
    const controller = new AbortController();
    const abortReason = new Error("cancelled");
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        expect(abortSignal).toBeDefined();

        return await new Promise((_, reject) => {
          const rejectWithReason = () => reject(abortSignal?.reason);
          abortSignal?.addEventListener("abort", rejectWithReason, { once: true });
          controller.abort(abortReason);

          if (abortSignal?.aborted) rejectWithReason();
        });
      },
    });
    const ai = createAI({
      providers: {
        fake: () => () => model,
      },
      models: {
        fast: { provider: "fake", id: "fake-fast" },
      },
    });

    await expect(ai.generate({ model: "fast", prompt: "Hello", abortSignal: controller.signal })).rejects.toBe(
      abortReason,
    );
  });

  it("forwards maxRetries", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("provider failure");
      },
    });
    const ai = createAI({
      providers: {
        fake: () => () => model,
      },
      models: {
        fast: { provider: "fake", id: "fake-fast" },
      },
    });

    await expect(ai.generate({ model: "fast", prompt: "Hello", maxRetries: 0 })).rejects.toThrow("provider failure");
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("forwards timeout configurations", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        return await new Promise((_, reject) => {
          const rejectWithReason = () => reject(abortSignal?.reason);
          abortSignal?.addEventListener("abort", rejectWithReason, { once: true });

          if (abortSignal?.aborted) rejectWithReason();
        });
      },
    });
    const ai = createAI({
      providers: {
        fake: () => () => model,
      },
      models: {
        fast: { provider: "fake", id: "fake-fast" },
      },
    });

    await expect(
      ai.generate({ model: "fast", prompt: "Hello", maxRetries: 0, timeout: { totalMs: 10 } }),
    ).rejects.toBeDefined();
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
