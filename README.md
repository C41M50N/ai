# AI SDK Client

Type-safe AI client with model registry, lazy providers, and optional cost tracking—powered by [Vercel AI SDK](https://sdk.vercel.ai/)

## Installation

```bash
bun add @cbuff/ai ai
```

Install the provider SDKs you need:

```bash
bun add @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## Usage

```typescript
import { createAI } from "@cbuff/ai";
import { createOpenAI } from "@ai-sdk/openai";

const ai = createAI({
  providers: {
    openai: () => createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    anthropic: async () => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    },
  },
  models: {
    fast: { provider: "openai", id: "gpt-4o-mini" },
    smart: { provider: "openai", id: "gpt-4o", costs: { input: 2.5, output: 10 } },
    claude: { provider: "anthropic", id: "claude-sonnet-4-20250514", costs: { input: 3, output: 15 } },
  },
});

// Full autocomplete on model names
const { data, metadata } = await ai.generate({
  model: "fast",
  prompt: "Hello, world!",
  reasoning: "medium",
});

console.log(data);
console.log(metadata.totalCostUsd); // undefined if costs not configured
```

## Features

- **Type-safe model selection** — Full autocomplete on model aliases, provider references validated at compile time
- **Lazy provider loading** — Providers can be sync or async, loaded on first use and cached
- **Optional cost tracking** — Define `costs: { input, output }` per model (USD per 1M tokens), skip if you don't need it
- **Agents** — `ai.agent()` wraps the AI SDK's `ToolLoopAgent` with the same aliases, lazy loading, and cost tracking
- **Unified config** — Single `createAI()` call with providers and models in one object

## Why not use Vercel's AI SDK directly?

Vercel's SDK is a great foundation, but this wrapper solves the gaps that show up once you use it across multiple models and providers:

- **Model registry with autocomplete** — Define named model aliases once and get compile-time safety everywhere you call `ai.generate` or `ai.agent`.
- **Lazy provider wiring** — Configure providers as sync or async factories so you only load SDKs when you actually need them.
- **Built-in cost tracking** — Attach per-model USD rates and get cost metadata back without extra bookkeeping.
- **One config surface** — Providers, models, and defaults live together instead of being stitched across call sites.

## API

### `createAI(config)`

Creates a typed AI client.

```typescript
const ai = createAI({
  providers: {
    [key: string]: () => Provider | Promise<Provider>
  },
  models: {
    [alias: string]: {
      provider: string;  // must match a key in providers
      id: string;        // provider model ID (typed per provider)
      costs?: { input: number; output: number };  // USD per 1M tokens
    }
  }
});
```

### `ai.generate(params)`

Generate text or structured output.

```typescript
const { data, metadata } = await ai.generate({
  model: "fast", // required, autocompletes to your model aliases
  prompt: "Hello", // provide exactly one of prompt or messages
  instructions: "Be helpful", // optional
  temperature: 0.7, // optional
  maxOutputTokens: 1000, // optional
  reasoning: "high", // optional, standardized by AI SDK v7
  providerOptions: {}, // optional, raw provider-specific escape hatch
  abortSignal: controller.signal, // optional, cancels the request
  maxRetries: 0, // optional, defaults to AI SDK's retry behavior
  timeout: { totalMs: 30_000 }, // optional, AI SDK timeout configuration
  output: schema, // optional, for structured output
  logKey: "my-request", // optional, logs timing and cost
});
```

Every other `generateText` option from the AI SDK (`tools`, `stopWhen`, `onFinish`, `headers`, and so on) is forwarded unchanged. The wrapper only redefines `model` (an alias instead of a model instance), `prompt` (text only), `messages`, and `output`. The SDK's deprecated `system` option is not exposed; use `instructions`.

For multimodal input, combine text and file parts with a model that supports the supplied media. For example, given image bytes in `imageBytes`:

```typescript
const { data } = await ai.generate({
  model: "smart", // configure this alias to use a model that supports images
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "file", data: imageBytes, mediaType: "image/png" },
      ],
    },
  ],
});
```

Both input forms support `output` with the same inferred structured result type. Import message types and output helpers directly from `ai`. Conversation storage and model media capabilities remain the caller's responsibility; use `instructions` for system instructions.

Cost tracking is keyed to the `model` alias. If a `prepareStep` callback swaps in a different model instance for a step, the usage from that step is still priced at the alias's configured rates.

`reasoning` uses AI SDK v7's provider-agnostic reasoning levels: `"provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh"`. The AI SDK translates the selected level into provider-native settings. This library does not validate whether an individual model supports a given reasoning value. Use `providerOptions` for provider-specific settings outside the standardized levels.

### `ai.agent(settings)`

Create an agent backed by the AI SDK's [`ToolLoopAgent`](https://ai-sdk.dev/docs/agents/overview). It takes every `ToolLoopAgentSettings` option, with `model` as a registry alias instead of a model instance, plus the wrapper's `logKey`. Creating an agent is synchronous and does nothing until the first call; the provider and model are resolved lazily on the first `generate` or `stream`.

```typescript
import { tool, stepCountIs } from "ai";
import { z } from "zod";

const weather = tool({
  description: "Get the weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ city, tempC: 21 }),
});

const assistant = ai.agent({
  model: "smart", // required, autocompletes to your model aliases
  instructions: "You are a helpful assistant.",
  tools: { weather },
  stopWhen: stepCountIs(5),
  logKey: "assistant", // optional, logs timing, steps, and cost per run
});

const result = await assistant.generate({ prompt: "What's the weather in Paris?" });
console.log(result.text);
console.log(result.steps.length, result.metadata.totalCostUsd);
```

`generate` and `stream` return the AI SDK's own result objects, unchanged, with a `metadata` field added. Token counts and costs are summed across every step of the tool loop.

- `generate` returns `GenerateTextResult & { metadata: GenerateMetadata }`.
- `stream` returns `StreamTextResult & { metadata: Promise<GenerateMetadata> }`. The promise resolves once the stream has finished, so it never settles if the stream is never consumed. It rejects with an `AIGenerationError` if the stream fails.

```typescript
const stream = await assistant.stream({ prompt: "Summarize today's weather." });
for await (const chunk of stream.textStream) process.stdout.write(chunk);
const { totalCostUsd, steps } = await stream.metadata;
```

The returned object implements the AI SDK's `Agent` interface, so it works with `createAgentUIStreamResponse`, `InferAgentUIMessage`, and the other agent helpers:

```typescript
import { createAgentUIStreamResponse, type InferAgentUIMessage } from "ai";

export type AssistantUIMessage = InferAgentUIMessage<typeof assistant>;

export async function POST(request: Request) {
  const { messages } = await request.json();
  return createAgentUIStreamResponse({ agent: assistant, uiMessages: messages });
}
```

`callOptionsSchema` and `prepareCall` pass through unchanged, so per-call `options` are typed and validated by the SDK. Cost tracking is keyed to the `model` alias: if `prepareCall` or `prepareStep` swaps in a different model instance, the usage is still priced at the alias's configured rates.

### `ai.models`

Returns the list of registered model aliases in the order they were defined.

```typescript
ai.models; // ["fast", "smart", "claude"]

type ModelList = typeof ai.models;
type Model = ModelList[number];
```

### `AIGenerationError`

Failures from provider initialization, model creation, or generation are wrapped with model registry context:

```typescript
import { AIGenerationError } from "@cbuff/ai";

try {
  await ai.generate({ model: "fast", prompt: "Hello" });
} catch (error) {
  if (error instanceof AIGenerationError) {
    console.error(error.modelAlias, error.provider, error.modelId, error.stage);
    console.error(error.cause); // original provider or AI SDK error
  }
}
```

Agent `generate` and `stream` calls throw the same error. The `stage` is `"provider_initialization"`, `"model_creation"`, `"generation"`, or `"stream"`. Caller-provided abort reasons are rethrown unchanged.

**Returns:**

```typescript
{
  data: string | T,  // text or structured output
  metadata: {
    responseTimeMs: number,
    inputTokens: number,     // summed across all steps
    outputTokens: number,
    steps: number,           // number of model calls in the run
    inputCostUsd?: number,   // undefined if costs not configured
    outputCostUsd?: number,
    totalCostUsd?: number,
  }
}
```

## License

MIT
