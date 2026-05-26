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
  reasoningEffort: "medium",
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
  model: "fast",           // required, autocompletes to your model aliases
  prompt: "Hello",         // required
  system: "Be helpful",    // optional
  temperature: 0.7,        // optional
  maxOutputTokens: 1000,   // optional
  reasoningEffort: "high", // optional, typed from the selected model's provider
  providerOptions: {},     // optional, raw provider-specific escape hatch
  output: schema,          // optional, for structured output
  logKey: "my-request",    // optional, logs timing and cost
});
```

For top providers, `reasoningEffort` is provider-native and inferred from the selected model:

- OpenAI: `"none" | "minimal" | "low" | "medium" | "high" | "xhigh"`
- Anthropic: `"low" | "medium" | "high" | "max"`
- Google: `"minimal" | "low" | "medium" | "high"`

`reasoningEffort` is translated into provider-specific `providerOptions` behind the scenes. This library does not validate whether an individual model supports a given reasoning value. For non-top providers, or for unsupported provider-specific knobs, use `providerOptions` directly.

### `ai.models`

Returns the list of registered model aliases in the order they were defined.

```typescript
ai.models; // ["fast", "smart", "claude"]

type ModelList = typeof ai.models;
type Model = ModelList[number];
```

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
