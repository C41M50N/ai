import { describe, expect, it } from "bun:test";

import { createAgentUIStreamResponse, jsonSchema, simulateReadableStream, tool, type InferAgentUIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { AIGenerationError, createAI } from "./index.js";
import type { AIAgent } from "./index.js";

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const textResponse = (text: string, input = 10, output = 5) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: usage(input, output),
  warnings: [],
});

const lookup = tool({
  description: "Look something up",
  inputSchema: jsonSchema<{ query: string }>({
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  }),
  execute: async ({ query }) => `result for ${query}`,
});

const makeClient = (model: MockLanguageModelV4, onProviderInit?: () => void) =>
  createAI({
    providers: {
      fake: () => {
        onProviderInit?.();
        return () => model;
      },
    },
    models: {
      fast: { provider: "fake", id: "fake-fast" },
      smart: { provider: "fake", id: "fake-smart", costs: { input: 2.5, output: 10 } },
    },
  });

describe("ai.agent", () => {
  it("implements the AI SDK Agent interface", () => {
    const model = new MockLanguageModelV4();
    const ai = makeClient(model);
    const agent = ai.agent({ model: "fast", id: "helper", tools: { lookup } });

    expect(agent.version).toBe("agent-v1");
    expect(agent.id).toBe("helper");
    expect(agent.tools).toEqual({ lookup });
    expect(typeof agent.generate).toBe("function");
    expect(typeof agent.stream).toBe("function");

    const sdkAgent: AIAgent<never, { lookup: typeof lookup }> = agent;
    expect(sdkAgent).toBe(agent);
  });

  it("defaults tools to an empty object", () => {
    const ai = makeClient(new MockLanguageModelV4());
    expect(ai.agent({ model: "fast" }).tools).toEqual({});
  });

  it("rejects unknown model aliases", () => {
    const ai = makeClient(new MockLanguageModelV4());
    // @ts-expect-error unknown alias
    expect(() => ai.agent({ model: "nope" })).toThrow('Unknown model alias "nope"');
  });

  it("does not initialize the provider until the first call", async () => {
    let inits = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => textResponse("Hello") });
    const ai = makeClient(model, () => inits++);

    const agent = ai.agent({ model: "fast" });
    expect(inits).toBe(0);

    await agent.generate({ prompt: "Hi" });
    expect(inits).toBe(1);

    await agent.generate({ prompt: "Hi again" });
    expect(inits).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("shares one provider initialization across concurrent first calls", async () => {
    let inits = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => textResponse("Hello") });
    const ai = makeClient(model, () => inits++);
    const agent = ai.agent({ model: "fast" });

    await Promise.all([agent.generate({ prompt: "a" }), agent.generate({ prompt: "b" })]);
    expect(inits).toBe(1);
  });

  it("runs a multi-step tool loop and sums usage and cost across steps", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const hasToolResult = prompt.some((m) => m.role === "tool");
        if (hasToolResult) return textResponse("Done", 300, 40);
        return {
          content: [{ type: "tool-call" as const, toolCallId: "call-1", toolName: "lookup", input: '{"query":"x"}' }],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage: usage(100, 20),
          warnings: [],
        };
      },
    });
    const ai = makeClient(model);
    const agent = ai.agent({ model: "smart", instructions: "Be brief", tools: { lookup } });

    const result = await agent.generate({ prompt: "Look up x" });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[0]?.prompt[0]).toEqual({ role: "system", content: "Be brief" });
    expect(result.text).toBe("Done");
    expect(result.steps).toHaveLength(2);
    expect(result.toolResults[0]?.output).toBe("result for x");
    expect(result.metadata).toMatchObject({ inputTokens: 400, outputTokens: 60, steps: 2 });
    expect(result.metadata.inputCostUsd).toBeCloseTo(0.001, 10);
    expect(result.metadata.outputCostUsd).toBeCloseTo(0.0006, 10);
    expect(result.metadata.totalCostUsd).toBeCloseTo(0.0016, 10);
    expect(result.metadata.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("leaves costs undefined when the model has none configured", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResponse("Hello", 100, 20) });
    const ai = makeClient(model);

    const result = await ai.agent({ model: "fast" }).generate({ prompt: "Hi" });

    expect(result.metadata).toEqual({
      responseTimeMs: expect.any(Number),
      inputTokens: 100,
      outputTokens: 20,
      steps: 1,
    });
  });

  it("exposes stream metadata as a promise that resolves when the stream finishes", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "Hel" },
            { type: "text-delta", id: "t", delta: "lo" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(200, 50) },
          ],
        }),
      }),
    });
    const ai = makeClient(model);
    const agent = ai.agent({ model: "smart" });

    const result = await agent.stream({ prompt: "Hi" });
    expect(result.metadata).toBeInstanceOf(Promise);

    let text = "";
    for await (const chunk of result.textStream) text += chunk;

    expect(text).toBe("Hello");
    await expect(result.metadata).resolves.toMatchObject({
      inputTokens: 200,
      outputTokens: 50,
      steps: 1,
      totalCostUsd: 0.001,
    });
  });

  it("rejects stream metadata with an AIGenerationError when the stream fails", async () => {
    const streamError = new Error("stream broke");
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw streamError;
      },
    });
    const ai = makeClient(model);
    const agent = ai.agent({ model: "fast", maxRetries: 0 });

    // The SDK reports stream failures through console.error by default; keep test output quiet.
    const originalError = console.error;
    console.error = () => {};
    let error: unknown;
    try {
      const result = await agent.stream({ prompt: "Hi" });
      await result.consumeStream();
      error = await result.metadata.catch((error) => error);
    } finally {
      console.error = originalError;
    }

    expect(error).toBeInstanceOf(AIGenerationError);
    expect(error).toMatchObject({ modelAlias: "fast", stage: "stream", cause: streamError });
  });

  it("wraps generation failures in AIGenerationError", async () => {
    const providerError = new Error("provider failure");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw providerError;
      },
    });
    const ai = makeClient(model);
    const agent = ai.agent({ model: "fast", maxRetries: 0 });

    const error = await agent.generate({ prompt: "Hi" }).catch((error) => error);

    expect(error).toBeInstanceOf(AIGenerationError);
    expect(error).toMatchObject({
      modelAlias: "fast",
      provider: "fake",
      modelId: "fake-fast",
      stage: "generation",
      cause: providerError,
    });
  });

  it("wraps provider initialization failures and retries on the next call", async () => {
    let attempts = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => textResponse("Hello") });
    const ai = createAI({
      providers: {
        fake: () => {
          attempts++;
          if (attempts === 1) throw new Error("not yet");
          return () => model;
        },
      },
      models: { fast: { provider: "fake", id: "fake-fast" } },
    });
    const agent = ai.agent({ model: "fast" });

    const error = await agent.generate({ prompt: "Hi" }).catch((error) => error);
    expect(error).toBeInstanceOf(AIGenerationError);
    expect(error.stage).toBe("provider_initialization");

    const result = await agent.generate({ prompt: "Hi" });
    expect(result.text).toBe("Hello");
    expect(attempts).toBe(2);
  });

  it("rethrows caller-provided abort reasons unchanged", async () => {
    const controller = new AbortController();
    const abortReason = new Error("cancelled");
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) =>
        await new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
          controller.abort(abortReason);
        }),
    });
    const ai = makeClient(model);
    const agent = ai.agent({ model: "fast", maxRetries: 0 });

    await expect(agent.generate({ prompt: "Hi", abortSignal: controller.signal })).rejects.toBe(abortReason);
  });

  it("passes callOptionsSchema and prepareCall through to the SDK agent", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResponse("Hello") });
    const ai = makeClient(model);
    const agent = ai.agent({
      model: "fast",
      callOptionsSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      prepareCall: ({ options, ...rest }) => ({
        ...rest,
        instructions: `Greet ${options.name}`,
      }),
    });

    await agent.generate({ prompt: "Hi", options: { name: "Ada" } });

    expect(model.doGenerateCalls[0]?.prompt[0]).toEqual({ role: "system", content: "Greet Ada" });
    // @ts-expect-error options are required once callOptionsSchema is set
    const missing = () => agent.generate({ prompt: "Hi" });
    expect(typeof missing).toBe("function");
  });

  it("logs timing, steps, and cost when logKey is set", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResponse("Hello", 100, 20) });
    const ai = makeClient(model);
    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => logs.push(line);
    try {
      await ai.agent({ model: "smart", logKey: "helper" }).generate({ prompt: "Hi" });
    } finally {
      console.log = original;
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(
      /^\[LLM\]\[helper\] \d+\.\d\ds using smart cost: \$0\.0005 \(in: \$0\.0003, out: \$0\.0002\)$/,
    );
  });

  it("works with createAgentUIStreamResponse", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "Hello from the agent" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(10, 5) },
          ],
        }),
      }),
    });
    const ai = makeClient(model);
    const agent = ai.agent({ model: "fast", tools: { lookup } });
    type UIMessage = InferAgentUIMessage<typeof agent>;
    const uiMessages: UIMessage[] = [{ id: "1", role: "user", parts: [{ type: "text", text: "Hi" }] }];

    const response = await createAgentUIStreamResponse({ agent, uiMessages });
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("Hello from the agent");
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
