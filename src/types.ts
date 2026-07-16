import type { generateText, InferGenerateOutput, LanguageModel, Output } from "ai";

// ############################################################################
// Provider Types
// ############################################################################

/**
 * A provider instance that can create language models.
 * This is the return type of provider factories like `createOpenAI()`.
 * @template TModelId - Union of model IDs supported by the provider
 */
export type LanguageModelProvider<TModelId extends string = string> = (modelId: TModelId) => LanguageModel;

/**
 * A factory function that creates a provider instance.
 * Can be sync or async (for lazy-loading provider SDKs).
 * @template TModelId - Union of model IDs supported by the provider
 */
export type ProviderFactory<TModelId extends string = string> = () =>
  | LanguageModelProvider<TModelId>
  | Promise<LanguageModelProvider<TModelId>>;

// ############################################################################
// Model Types
// ############################################################################

type ProviderModelId<TProviderFactory extends ProviderFactory> =
  Awaited<ReturnType<TProviderFactory>> extends LanguageModelProvider<infer TModelId> ? TModelId : string;

/**
 * Configuration for a single model.
 * @template TProviders - Record of provider factories
 */
export type ModelEntry<TProviders extends Record<string, ProviderFactory>> = {
  [TProviderKey in keyof TProviders & string]: {
    /** The provider key to use for this model */
    provider: TProviderKey;
    /** The actual model ID to pass to the provider */
    id: ProviderModelId<TProviders[TProviderKey]>;
    /** Optional cost tracking (per 1M tokens in USD) */
    costs?: {
      input: number;
      output: number;
    };
  };
}[keyof TProviders & string];

// ############################################################################
// Config Types
// ############################################################################

/**
 * Full configuration object for createAI.
 * @template TProviders - Record of provider factories
 * @template TModels - Record of model configurations
 */
export type AIConfig<
  TProviders extends Record<string, ProviderFactory>,
  TModels extends Record<string, ModelEntry<TProviders>>,
> = {
  providers: TProviders;
  models: TModels;
};

// ############################################################################
// Generate Types
// ############################################################################

type GenerateTextParams = Parameters<typeof generateText>[0];

type DefaultOutput = Output.Output<string, string>;

/**
 * Parameters for the generate function.
 * @template TModels - Union of available model keys
 * @template TOutput - Output schema type
 */
type SharedGenerateParams<TOutput extends Output.Output = DefaultOutput> = {
  /** The user prompt */
  prompt: string;
  /** Optional system prompt */
  system?: string;
  /** Optional output schema for structured generation */
  output?: TOutput;
  /** Optional key for logging */
  logKey?: string;
} & Pick<GenerateTextParams, "temperature" | "maxOutputTokens" | "reasoning" | "providerOptions">;

/**
 * Parameters for the generate function.
 * @template TModels - Record of available model configurations
 * @template TOutput - Output schema type
 */
export type GenerateParams<
  TModels extends Record<string, { provider: string }>,
  TOutput extends Output.Output = DefaultOutput,
> = SharedGenerateParams<TOutput> & {
  /** The model alias to use */
  model: keyof TModels & string;
};

/**
 * Response metadata from a generate call.
 */
export type GenerateMetadata = {
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Number of input tokens used */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Cost of input tokens in USD (undefined if costs not configured) */
  inputCostUsd?: number;
  /** Cost of output tokens in USD (undefined if costs not configured) */
  outputCostUsd?: number;
  /** Total cost in USD (undefined if costs not configured) */
  totalCostUsd?: number;
};

/**
 * Response from a generate call.
 * @template TOutput - Output schema type
 */
export type GenerateResponse<TOutput extends Output.Output = DefaultOutput> = {
  /** The generated data */
  data: InferGenerateOutput<TOutput>;
  /** Metadata about the generation */
  metadata: GenerateMetadata;
};
