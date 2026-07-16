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
- **Unified config** — Single `createAI()` call with providers and models in one object

## Why not use Vercel's AI SDK directly?

Vercel's SDK is a great foundation, but this wrapper solves the gaps that show up once you use it across multiple models and providers:

- **Model registry with autocomplete** — Define named model aliases once and get compile-time safety everywhere you call `ai.generate`.
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
  prompt: "Hello", // required
  system: "Be helpful", // optional
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

`reasoning` uses AI SDK v7's provider-agnostic reasoning levels: `"provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh"`. The AI SDK translates the selected level into provider-native settings. This library does not validate whether an individual model supports a given reasoning value. Use `providerOptions` for provider-specific settings outside the standardized levels.

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

The `stage` is `"provider_initialization"`, `"model_creation"`, or `"generation"`. Caller-provided abort
reasons are rethrown unchanged.

**Returns:**

```typescript
{
  data: string | T,  // text or structured output
  metadata: {
    responseTimeMs: number,
    inputTokens: number,
    outputTokens: number,
    inputCostUsd?: number,   // undefined if costs not configured
    outputCostUsd?: number,
    totalCostUsd?: number,
  }
}
```

## License

MIT
