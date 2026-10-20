import {
  generateText,
  ToolLoopAgent,
  type LanguageModel,
  type LanguageModelUsage,
  type Output,
  type ToolLoopAgentSettings,
  type ToolSet,
} from "ai";

import { AIGenerationError, WRAPPER_ONLY_KEYS } from "./types.js";
import type {
  AgentContext,
  AgentSettings,
  AIAgent,
  AIGenerationErrorStage,
  GenerateMetadata,
  GenerateParams,
  GenerateResponse,
  LanguageModelProvider,
  ModelEntry,
  ProviderFactory,
} from "./types.js";

// Re-export public types
export type {
  AgentContext,
  AgentGenerateResult,
  AgentSettings,
  AgentStreamResult,
  AIAgent,
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

  // Provider cache: the pending promise is cached (not the resolved value) so
  // concurrent first calls share a single factory invocation. A failed factory
  // is evicted so the next call retries it.
  const providerCache = new Map<keyof TProviders, Promise<LanguageModelProvider>>();

  /**
   * Resolves a provider by key, using cache if available.
   */
  async function getProvider(
    providerKey: keyof TProviders,
    context: { modelAlias: string; modelId: string },
  ): Promise<LanguageModelProvider> {
    let pending = providerCache.get(providerKey);
    if (!pending) {
      pending = Promise.resolve().then(() => config.providers[providerKey]!());
      providerCache.set(providerKey, pending);
      pending.catch(() => providerCache.delete(providerKey));
    }

    try {
      return await pending;
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
   * Wraps a failure with model registry context. Caller-provided abort
   * reasons are returned unchanged so they can be rethrown as-is.
   */
  function wrapError(
    modelKey: keyof TModels,
    stage: AIGenerationErrorStage,
    cause: unknown,
    abortSignal: AbortSignal | undefined,
  ): unknown {
    if (abortSignal?.aborted && cause === abortSignal.reason) return cause;

    const modelConfig = config.models[modelKey]!;
    return new AIGenerationError({
      modelAlias: String(modelKey),
      provider: String(modelConfig.provider),
      modelId: String(modelConfig.id),
      stage,
      cause,
    });
  }

  /**
   * Builds response metadata from a finished run (usage summed across all
   * steps), and logs timing and cost if a log key was given.
   */
  function buildMetadata(
    modelKey: keyof TModels,
    run: { totalUsage: LanguageModelUsage; steps: ArrayLike<unknown> },
    startTime: number,
    logKey: string | undefined,
  ): GenerateMetadata {
    const responseTimeMs = Date.now() - startTime;
    const steps = run.steps.length;
    const inputTokens = run.totalUsage.inputTokens ?? 0;
    const outputTokens = run.totalUsage.outputTokens ?? 0;
    const modelConfig = config.models[modelKey]!;

    let costs: Pick<GenerateMetadata, "inputCostUsd" | "outputCostUsd" | "totalCostUsd"> = {};
    if (modelConfig.costs) {
      const inputCostUsd = (inputTokens / 1_000_000) * modelConfig.costs.input;
      const outputCostUsd = (outputTokens / 1_000_000) * modelConfig.costs.output;
      costs = { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
    }

    if (logKey) {
      const stepsStr = steps > 1 ? ` over ${steps} steps` : "";
      const costStr =
        costs.totalCostUsd !== undefined
          ? ` cost: ${costFormatter.format(costs.totalCostUsd)} (in: ${costFormatter.format(costs.inputCostUsd!)}, out: ${costFormatter.format(costs.outputCostUsd!)})`
          : "";
      console.log(
        `[LLM][${logKey}] ${(responseTimeMs / 1000).toFixed(2)}s using ${String(modelKey)}${stepsStr}${costStr}`,
      );
    }

    return { responseTimeMs, inputTokens, outputTokens, steps, ...costs };
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
    const model = await getModel(modelAlias);

    const startTime = Date.now();
    let result;
    try {
      result = await generateText({
        ...options,
        model,
      });
    } catch (cause) {
      throw wrapError(modelAlias, "generation", cause, params.abortSignal);
    }

    return {
      data: (params.output ? result.output : result.text) as GenerateResponse<TOutput>["data"],
      metadata: buildMetadata(modelAlias, result, startTime, logKey),
    };
  }

  /**
   * Create an agent backed by the AI SDK's `ToolLoopAgent`. The provider and
   * model are resolved lazily on the first `generate` or `stream` call.
   *
   * @example
   * ```typescript
   * const assistant = ai.agent({
   *   model: "smart",
   *   instructions: "You are a helpful assistant.",
   *   tools: { weather },
   *   logKey: "assistant",
   * });
   *
   * const { text, metadata } = await assistant.generate({ prompt: "What's the weather in Paris?" });
   * ```
   */
  function agent<
    CALL_OPTIONS = never,
    TOOLS extends ToolSet = {},
    RUNTIME_CONTEXT extends AgentContext = AgentContext,
    OUTPUT extends Output.Output = never,
  >(
    settings: AgentSettings<TModels, CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>,
  ): AIAgent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT> {
    type SdkAgent = ToolLoopAgent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>;

    const { model: modelAlias, logKey } = settings;
    if (!(modelAlias in config.models)) {
      throw new Error(`Unknown model alias "${String(modelAlias)}"`);
    }
    const sdkSettings = omit(settings, WRAPPER_ONLY_KEYS);

    // The underlying agent is created on first use. The pending promise is
    // cached so concurrent first calls share one instance, and evicted on
    // failure so the next call retries provider initialization.
    let pending: Promise<SdkAgent> | undefined;
    function getAgent(): Promise<SdkAgent> {
      if (!pending) {
        pending = getModel(modelAlias).then(
          (model) =>
            // The SDK's conditional `toolsContext` type cannot be checked against
            // unresolved generics, so the assembled settings are asserted here.
            new ToolLoopAgent({ ...sdkSettings, model } as ToolLoopAgentSettings<
              CALL_OPTIONS,
              TOOLS,
              RUNTIME_CONTEXT,
              OUTPUT
            >),
        );
        pending.catch(() => {
          pending = undefined;
        });
      }
      return pending;
    }

    return {
      version: "agent-v1",
      get id() {
        return sdkSettings.id;
      },
      get tools() {
        return (sdkSettings.tools ?? {}) as TOOLS;
      },

      async generate(options) {
        const sdkAgent = await getAgent();
        const startTime = Date.now();
        let result;
        try {
          result = await sdkAgent.generate(options);
        } catch (cause) {
          throw wrapError(modelAlias, "generation", cause, options.abortSignal);
        }

        const metadata = buildMetadata(modelAlias, result, startTime, logKey);
        return Object.assign(result, { metadata });
      },

      async stream(options) {
        const sdkAgent = await getAgent();
        const startTime = Date.now();
        let result;
        try {
          result = await sdkAgent.stream(options);
        } catch (cause) {
          throw wrapError(modelAlias, "stream", cause, options.abortSignal);
        }

        const metadata = Promise.all([result.totalUsage, result.steps]).then(
          ([totalUsage, steps]) => buildMetadata(modelAlias, { totalUsage, steps }, startTime, logKey),
          (cause) => {
            throw wrapError(modelAlias, "stream", cause, options.abortSignal);
          },
        );
        // Callers may never await `metadata`; mark it handled so a failed
        // stream does not surface as an unhandled rejection.
        metadata.catch(() => {});

        return Object.assign(result, { metadata });
      },
    };
  }

  return { generate, agent, models };
}

export type { AIConfig } from "./types.js";
