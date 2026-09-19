import { generateText, type LanguageModel, type Output } from "ai";

import { AIGenerationError, WRAPPER_ONLY_KEYS } from "./types.js";
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
  AIGenerationErrorStage,
  GenerateMetadata,
  GenerateParams,
  GenerateResponse,
  LanguageModelProvider,
  ModelEntry,
  ProviderFactory,
  ReasoningEffort,
} from "./types.js";
export { AIGenerationError } from "./types.js";

// ############################################################################
// Cost Formatter
// ############################################################################

const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

// ############################################################################
// createAI Factory
// ############################################################################

/** `Omit` that distributes over unions instead of collapsing them. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Return a shallow copy of `obj` without the given keys.
 */
function omit<T extends object, K extends readonly (keyof T)[]>(obj: T, keys: K): DistributiveOmit<T, K[number]> {
  const result: Record<PropertyKey, unknown> = { ...(obj as Record<PropertyKey, unknown>) };
  for (const key of keys) {
    delete result[key];
  }
  return result as DistributiveOmit<T, K[number]>;
}

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
  async function getProvider(
    providerKey: keyof TProviders,
    context: { modelAlias: string; modelId: string },
  ): Promise<LanguageModelProvider> {
    const cached = providerCache.get(providerKey);
    if (cached) return cached;

    const factory = config.providers[providerKey]!;
    try {
      const provider = await Promise.resolve(factory());
      providerCache.set(providerKey, provider);
      return provider;
    } catch (cause) {
      throw new AIGenerationError({
        ...context,
        provider: String(providerKey),
        stage: "provider_initialization",
        cause,
      });
    }
  }

  /**
   * Gets a language model instance for the given model alias.
   */
  async function getModel(modelKey: keyof TModels): Promise<LanguageModel> {
    const modelConfig = config.models[modelKey]!;
    const context = {
      modelAlias: String(modelKey),
      modelId: String(modelConfig.id),
    };
    const provider = await getProvider(modelConfig.provider, context);

    try {
      return provider(modelConfig.id);
    } catch (cause) {
      throw new AIGenerationError({
        ...context,
        provider: String(modelConfig.provider),
        stage: "model_creation",
        cause,
      });
    }
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
    const { model: modelAlias, logKey } = params;
    // Strip wrapper-only keys so they never reach the SDK. Wrapper-owned SDK
    // keys (currently `model`) are placed after the spread so they always win.
    const options = omit(params, WRAPPER_ONLY_KEYS);
    const modelConfig = config.models[modelAlias]!;
    const model = await getModel(modelAlias);

    const startTime = Date.now();
    let result;
    try {
      result = await generateText({
        ...options,
        model,
      });
    } catch (cause) {
      if (params.abortSignal?.aborted && cause === params.abortSignal.reason) {
        throw cause;
      }

      throw new AIGenerationError({
        modelAlias: String(modelAlias),
        provider: String(modelConfig.provider),
        modelId: String(modelConfig.id),
        stage: "generation",
        cause,
      });
    }
    const endTime = Date.now();

    const responseTimeMs = endTime - startTime;
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const costs = calculateCosts(modelAlias, inputTokens, outputTokens);

    // Log if requested
    if (logKey) {
      const costStr =
        costs.totalCostUsd !== undefined
          ? ` cost: ${costFormatter.format(costs.totalCostUsd)} (in: ${costFormatter.format(costs.inputCostUsd!)}, out: ${costFormatter.format(costs.outputCostUsd!)})`
          : "";
      console.log(`[LLM][${logKey}] ${(responseTimeMs / 1000).toFixed(2)}s using ${String(modelAlias)}${costStr}`);
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
