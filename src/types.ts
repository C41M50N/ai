import type {
  Agent,
  AgentCallParameters,
  AgentStreamParameters,
  generateText,
  GenerateTextResult,
  InferGenerateOutput,
  LanguageModel,
  ModelMessage,
  Output,
  StreamTextResult,
  ToolLoopAgentSettings,
  ToolSet,
} from "ai";

// ############################################################################
// Error Types
// ############################################################################

export type AIGenerationErrorStage = "provider_initialization" | "model_creation" | "generation" | "stream";

/**
 * Error thrown when an `ai.generate` call or an agent `generate`/`stream` call fails.
 * Includes model registry context while preserving the original failure as cause.
 */
export class AIGenerationError extends Error {
  readonly modelAlias: string;
  readonly provider: string;
  readonly modelId: string;
  readonly stage: AIGenerationErrorStage;

  constructor(options: {
    modelAlias: string;
    provider: string;
    modelId: string;
    stage: AIGenerationErrorStage;
    cause: unknown;
  }) {
    const causeMessage = options.cause instanceof Error ? options.cause.message : String(options.cause);
    super(
      `AI generation failed for model "${options.modelAlias}" (provider "${options.provider}", model ID "${options.modelId}") during ${options.stage}: ${causeMessage}`,
      { cause: options.cause },
    );

    this.name = "AIGenerationError";
    this.modelAlias = options.modelAlias;
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.stage = options.stage;
  }
}

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

// ----------------------------------------------------------------------------
// Wrapper / SDK boundary
//
// `generate` forwards its params to the AI SDK's `generateText` via spread, so
// every SDK option works without this library having to enumerate it. The
// types and checks below keep that passthrough safe:
//
// - Wrapper-only keys are stripped at runtime before the spread.
// - SDK keys the wrapper redefines are omitted from the passthrough type and
//   re-declared with the wrapper's semantics.
// - Compile-time assertions fail the build if a wrapper-owned key ever
//   collides with an SDK key that is not explicitly listed as overridden.
// ----------------------------------------------------------------------------

/** Params that exist only on this wrapper and must never reach the AI SDK. */
export type WrapperOnlyParams = {
  /** Optional key for logging timing and cost */
  logKey?: string;
};

/** Runtime list of wrapper-only keys, stripped before forwarding to the SDK. */
export const WRAPPER_ONLY_KEYS = ["logKey"] as const satisfies readonly (keyof WrapperOnlyParams)[];

/** SDK keys the wrapper redefines with its own semantics or types. */
type OverriddenSdkKeys = "model" | "prompt" | "messages" | "output" | "system";

/** SDK-internal keys that are forwarded at runtime but hidden from the public type. */
type HiddenSdkKeys = "_internal";

/** Every key the wrapper declares itself, whether wrapper-only or an SDK override. */
type WrapperOwnedKeys = keyof WrapperOnlyParams | Exclude<OverriddenSdkKeys, "system">;

type Assert<T extends true> = T;

// Every key in WrapperOnlyParams must appear in WRAPPER_ONLY_KEYS, or it would leak to the SDK.
type _WrapperOnlyKeysComplete = Assert<
  Exclude<keyof WrapperOnlyParams, (typeof WRAPPER_ONLY_KEYS)[number]> extends never ? true : false
>;

// A wrapper-owned key that also exists on the SDK must be listed in OverriddenSdkKeys.
// This fails when an SDK upgrade introduces a field with the same name as a wrapper field.
type _NoSilentOverlap = Assert<
  Exclude<Extract<WrapperOwnedKeys, keyof GenerateTextParams>, OverriddenSdkKeys> extends never ? true : false
>;

/** AI SDK `generateText` options forwarded unchanged. */
type PassthroughParams = Omit<GenerateTextParams, OverriddenSdkKeys | HiddenSdkKeys>;

/**
 * Reasoning effort level for a generate call. Controls how much reasoning the
 * model performs before responding. Derived from AI SDK v7 to stay in sync.
 */
export type ReasoningEffort = NonNullable<GenerateTextParams["reasoning"]>;

/**
 * Generation input. Provide exactly one of `prompt` or `messages`.
 */
type GenerateInput =
  | {
      /** The user prompt */
      prompt: string;
      messages?: never;
    }
  | {
      /** The conversation messages */
      messages: Array<ModelMessage>;
      prompt?: never;
    };

type DefaultOutput = Output.Output<string, string>;

/**
 * Parameters for the generate function. Accepts every AI SDK `generateText`
 * option except the ones this wrapper redefines: `model` is an alias, `prompt`
 * is text-only, `messages` is the message form, `output` is typed by
 * `TOutput`, and the deprecated `system` is replaced by `instructions`.
 * @template TModels - Record of available model configurations
 * @template TOutput - Output schema type
 */
export type GenerateParams<
  TModels extends Record<string, { provider: string }>,
  TOutput extends Output.Output = DefaultOutput,
> = PassthroughParams &
  GenerateInput &
  WrapperOnlyParams & {
    /** The model alias to use */
    model: keyof TModels & string;
    /** Optional output schema for structured generation */
    output?: TOutput;
  };

/**
 * Response metadata from a generate call or an agent run. Token counts and
 * costs are summed across every step of a tool loop.
 */
export type GenerateMetadata = {
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Number of input tokens used */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Number of model calls (steps) in the run */
  steps: number;
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

// ############################################################################
// Agent Types
// ############################################################################

/** The runtime context constraint used by AI SDK agents (`Record<string, unknown>`). */
export type AgentContext = NonNullable<ToolLoopAgentSettings["runtimeContext"]>;

// `ai.agent` forwards its settings to the AI SDK's `ToolLoopAgent` via spread,
// so the same wrapper/SDK boundary rules as `generate` apply here.

/** `ToolLoopAgent` keys the wrapper redefines with its own semantics or types. */
type AgentOverriddenSdkKeys = "model";

/** Keys re-declared verbatim so TypeScript can infer the agent's type parameters from them. */
type AgentInferenceKeys = "tools" | "output" | "callOptionsSchema" | "runtimeContext";

type AgentWrapperOwnedKeys = keyof WrapperOnlyParams | AgentOverriddenSdkKeys;

// A wrapper-owned key that also exists on ToolLoopAgentSettings must be listed in AgentOverriddenSdkKeys.
type _NoSilentAgentOverlap = Assert<
  Exclude<Extract<AgentWrapperOwnedKeys, keyof ToolLoopAgentSettings>, AgentOverriddenSdkKeys> extends never
    ? true
    : false
>;

// The wrapper attaches `metadata` to the SDK result objects. This fails the
// build if an SDK upgrade ever adds a field with that name.
type _NoResultMetadataCollision = Assert<
  "metadata" extends
    | keyof GenerateTextResult<ToolSet, AgentContext, Output.Output>
    | keyof StreamTextResult<ToolSet, AgentContext, Output.Output>
    ? false
    : true
>;

/**
 * Settings for `ai.agent`. Accepts every AI SDK `ToolLoopAgentSettings` option
 * except `model`, which is a registry alias instead of a model instance.
 * @template TModels - Record of available model configurations
 * @template CALL_OPTIONS - Type of the per-call `options` (validated by `callOptionsSchema`)
 * @template TOOLS - The agent's tool set
 * @template RUNTIME_CONTEXT - Runtime context passed to tools
 * @template OUTPUT - Output schema type
 */
export type AgentSettings<
  TModels extends Record<string, { provider: string }>,
  CALL_OPTIONS = never,
  TOOLS extends ToolSet = {},
  RUNTIME_CONTEXT extends AgentContext = AgentContext,
  OUTPUT extends Output.Output = never,
> = Omit<
  ToolLoopAgentSettings<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>,
  AgentOverriddenSdkKeys | AgentInferenceKeys | HiddenSdkKeys
> &
  Pick<ToolLoopAgentSettings<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>, AgentInferenceKeys> &
  WrapperOnlyParams & {
    /** The model alias to use */
    model: keyof TModels & string;
  };

/** The AI SDK `generateText` result with cost metadata attached. */
export type AgentGenerateResult<
  TOOLS extends ToolSet = {},
  RUNTIME_CONTEXT extends AgentContext = AgentContext,
  OUTPUT extends Output.Output = never,
> = GenerateTextResult<TOOLS, RUNTIME_CONTEXT, OUTPUT> & {
  /** Metadata about the run, summed across all steps */
  metadata: GenerateMetadata;
};

/** The AI SDK `streamText` result with a cost metadata promise attached. */
export type AgentStreamResult<
  TOOLS extends ToolSet = {},
  RUNTIME_CONTEXT extends AgentContext = AgentContext,
  OUTPUT extends Output.Output = never,
> = StreamTextResult<TOOLS, RUNTIME_CONTEXT, OUTPUT> & {
  /**
   * Metadata about the run, summed across all steps. Resolves once the stream
   * has finished, so it never settles if the stream is never consumed. Rejects
   * with an `AIGenerationError` if the stream fails.
   */
  metadata: Promise<GenerateMetadata>;
};

/**
 * An agent created by `ai.agent`. Implements the AI SDK's `Agent` interface,
 * so it can be passed to helpers such as `createAgentUIStreamResponse`.
 */
export interface AIAgent<
  CALL_OPTIONS = never,
  TOOLS extends ToolSet = {},
  RUNTIME_CONTEXT extends AgentContext = AgentContext,
  OUTPUT extends Output.Output = never,
> extends Agent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT> {
  /** Runs the tool loop to completion and returns the SDK result with `metadata` attached. */
  generate(
    options: AgentCallParameters<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT>,
  ): Promise<AgentGenerateResult<TOOLS, RUNTIME_CONTEXT, OUTPUT>>;
  /** Streams the tool loop and returns the SDK result with a `metadata` promise attached. */
  stream(
    options: AgentStreamParameters<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT>,
  ): Promise<AgentStreamResult<TOOLS, RUNTIME_CONTEXT, OUTPUT>>;
}
