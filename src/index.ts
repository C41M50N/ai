import { generateText, type LanguageModel, type Output } from "ai";

import type {
  GenerateMetadata,
  GenerateParams,
  GenerateResponse,
  LanguageModelProvider,
  ModelEntry,
  ProviderFactory,
} from "./types.js";

// Re-export public types
export type {
  AnthropicReasoningEffort,
  GenerateMetadata,
  GenerateParams,
  GenerateResponse,
  GoogleReasoningEffort,
  LanguageModelProvider,
  ModelEntry,
  OpenAIReasoningEffort,
  ProviderFactory,
} from "./types.js";

// ############################################################################
// Cost Formatter
// ############################################################################

const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

type GenerateTextParams = Parameters<typeof generateText>[0];
type ProviderOptions = GenerateTextParams["providerOptions"];
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue | undefined };

// ############################################################################
// createAI Factory
// ############################################################################

/**
  * Creates a type-safe AI client with the given providers and models.

 *
 * @example
 * ```typescript
 * import { createAI } from "@cbuff/ai";
 * import { createOpenAI } from "@ai-sdk/openai";
 *
 * const ai = createAI({
 *   providers: {
 *     openai: () => createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
 *   },
 *   models: {
 *     fast: { provider: "openai", id: "gpt-4o-mini" },
 *     smart: { provider: "openai", id: "gpt-4o", costs: { input: 2.5, output: 10 } },
 *   },
 * });
 *
 * const { data } = await ai.generate({ model: "fast", prompt: "Hello" });
 * ```
 */
export function createAI<
  TProviders extends Record<string, ProviderFactory>,
  TModels extends Record<string, ModelEntry<TProviders>>,
>(config: { providers: TProviders; models: TModels }) {
  const models = Object.freeze(Object.keys(config.models) as Array<keyof TModels & string>) as ReadonlyArray<
    keyof TModels & string
  >;

  // Provider cache: lazily resolved and stored
  const providerCache = new Map<keyof TProviders, LanguageModelProvider>();

  /**
   * Resolves a provider by key, using cache if available.
   */
  async function getProvider(providerKey: keyof TProviders): Promise<LanguageModelProvider> {
    const cached = providerCache.get(providerKey);
    if (cached) return cached;

    const factory = config.providers[providerKey]!;
    const provider = await Promise.resolve(factory());
    providerCache.set(providerKey, provider);
    return provider;
  }

  /**
   * Gets a language model instance for the given model alias.
   */
  async function getModel(modelKey: keyof TModels): Promise<LanguageModel> {
    const modelConfig = config.models[modelKey]!;
    const provider = await getProvider(modelConfig.provider);
    return provider(modelConfig.id);
  }

  function buildProviderOptions(
    providerKey: string,
    reasoningEffort: string | undefined,
    providerOptions: ProviderOptions,
  ): ProviderOptions {
    if (!reasoningEffort) {
      return providerOptions;
    }

    const generatedProviderOptions = getReasoningProviderOptions(providerKey, reasoningEffort);
    if (!generatedProviderOptions) {
      return providerOptions;
    }

    const existingProviderOptions = providerOptions?.[providerKey];
    return {
      ...providerOptions,
      [providerKey]: {
        ...generatedProviderOptions,
        ...(isPlainObject(existingProviderOptions) ? existingProviderOptions : {}),
      },
    };
  }

  /**
   * Calculates costs for the given model and token usage.
   * Returns undefined values if costs are not configured.
   */
  function calculateCosts(
    modelKey: keyof TModels,
    inputTokens: number,
    outputTokens: number,
  ): Pick<GenerateMetadata, "inputCostUsd" | "outputCostUsd" | "totalCostUsd"> {
    const modelConfig = config.models[modelKey]!;

    if (!modelConfig.costs) {
      return {
        inputCostUsd: undefined,
        outputCostUsd: undefined,
        totalCostUsd: undefined,
      };
    }

    const inputCostUsd = (inputTokens / 1_000_000) * modelConfig.costs.input;
    const outputCostUsd = (outputTokens / 1_000_000) * modelConfig.costs.output;
    const totalCostUsd = inputCostUsd + outputCostUsd;

    return { inputCostUsd, outputCostUsd, totalCostUsd };
  }

  /**
   * Generate text or structured output using the configured models.
   */
  async function generate<TOutput extends Output.Output = Output.Output<string, string>>(
    params: GenerateParams<TModels, TOutput>,
  ): Promise<GenerateResponse<TOutput>> {
    const modelConfig = config.models[params.model]!;
    const model = await getModel(params.model);
    const providerOptions = buildProviderOptions(modelConfig.provider, params.reasoningEffort, params.providerOptions);

    const startTime = Date.now();
    const result = await generateText({
      model,
      prompt: params.prompt,
      system: params.system,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      providerOptions,
      experimental_output: params.output,
    });
    const endTime = Date.now();

    const responseTimeMs = endTime - startTime;
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const costs = calculateCosts(params.model, inputTokens, outputTokens);

    // Log if requested
    if (params.logKey) {
      const costStr =
        costs.totalCostUsd !== undefined
          ? ` cost: ${costFormatter.format(costs.totalCostUsd)} (in: ${costFormatter.format(costs.inputCostUsd!)}, out: ${costFormatter.format(costs.outputCostUsd!)})`
          : "";
      console.log(
        `[LLM][${params.logKey}] ${(responseTimeMs / 1000).toFixed(2)}s using ${String(params.model)}${costStr}`,
      );
    }

    return {
      data: (params.output ? result.output : result.text) as GenerateResponse<TOutput>["data"],
      metadata: {
        responseTimeMs,
        inputTokens,
        outputTokens,
        ...costs,
      },
    };
  }

  return { generate, models };
}

export type { AIConfig } from "./types.js";

function getReasoningProviderOptions(providerKey: string, reasoningEffort: string): JsonObject | undefined {
  switch (providerKey) {
    case "openai":
      return { reasoningEffort };
    case "anthropic":
      return {
        thinking: { type: "adaptive" },
        effort: reasoningEffort,
      };
    case "google":
      return {
        thinkingConfig: {
          thinkingLevel: reasoningEffort,
        },
      };
    default:
      return undefined;
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
