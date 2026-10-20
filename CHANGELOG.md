# Changelog

## 3.1.0 - 2026-10-20

### Added

- Add `ai.agent(settings)`, a wrapper around the AI SDK's `ToolLoopAgent`. It accepts every `ToolLoopAgentSettings` option with `model` as a registry alias, plus `logKey`. The provider and model are resolved lazily on the first `generate` or `stream` call.
- Agent `generate` and `stream` return the AI SDK's own result objects with a `metadata` field added. For `generate` it holds the cost data directly; for `stream` it is a `Promise` that resolves when the stream finishes. The returned object implements the AI SDK `Agent` interface, so it works with `createAgentUIStreamResponse` and `InferAgentUIMessage`.
- Add a `steps` field to `GenerateMetadata` with the number of model calls in the run.
- Add a `"stream"` stage to `AIGenerationError` for agent stream failures.
- Export the `AIAgent`, `AgentSettings`, `AgentGenerateResult`, `AgentStreamResult`, and `AgentContext` types.
- Add a compile-time assertion that fails the build if an AI SDK upgrade adds a `metadata` field to its result objects.

### Fixed

- `ai.generate` now reports token usage and cost summed across every step of a tool loop (`totalUsage`). Previously only the final step was counted when `tools` and `stopWhen` produced multiple steps.
- Concurrent first calls to the same provider now share a single factory invocation, and a failed factory is retried on the next call instead of being cached.

### Changed

- The `logKey` log line includes the step count for multi-step runs.
- Update the `ai` development dependency to 7.0.146 (the example uses the same version).

## 3.0.0 - 2026-09-19

### Breaking changes

- Remove the `system` generation option. Use the AI SDK's `instructions` option instead; the deprecated `system` option is no longer accepted by `ai.generate`.
- `prompt` now accepts only a string. Pass conversation history through the new `messages` option instead of an array prompt.

### Added

- Add `messages` as an alternative to `prompt` for `ai.generate`, supporting multi-turn and multimodal (text plus file parts) input. Exactly one of `prompt` or `messages` is required, enforced at the type level.
- Forward every AI SDK `generateText` option unchanged, including `tools`, `stopWhen`, `onFinish`, `headers`, and sampling settings such as `topP` and `seed`. Previously only a fixed set of seven options was accepted.
- Add compile-time assertions that fail the build if a wrapper-owned field (`model`, `prompt`, `messages`, `output`, `logKey`) ever collides with an AI SDK option that is not explicitly redefined by this library.

### Changed

- `instructions` now uses the AI SDK's `Instructions` type (`string | SystemModelMessage | SystemModelMessage[]`) instead of `string`.
- Strip wrapper-only fields such as `logKey` at runtime before calling the AI SDK.
- Hide the AI SDK's internal `_internal` option from the `GenerateParams` type.
- Add a scheduled GitHub Actions workflow for automated dependency updates and audits.
- Update development dependencies (`ai` to 7.0.79, `oxlint` to 1.80.0).

### Migration

- Rename `system` to `instructions` in calls to `ai.generate`.
- If you were passing an array of messages as `prompt`, move it to `messages`.

## 2.1.0 - 2026-07-22

### Added

- Add `abortSignal`, `maxRetries`, and `timeout` pass-through options to `ai.generate`.
- Add `AIGenerationError` with model alias, provider, model ID, failure stage, and the original error as `cause`.
- Export a `ReasoningEffort` type derived from AI SDK v7's standardized `reasoning` option.

## 2.0.0 - 2026-07-16

### Breaking changes

- Require AI SDK v7.
- Replace the provider-specific `reasoningEffort` generation option with AI SDK v7's standardized `reasoning` option.
- Remove the exported `OpenAIReasoningEffort`, `AnthropicReasoningEffort`, and `GoogleReasoningEffort` types. The `reasoning` type is now derived directly from AI SDK v7.

### Changed

- Use the stable `output` option for structured generation instead of `experimental_output`.
- Update the example project to AI SDK v7 and `@ai-sdk/google` v4.
- Continue to support provider-specific reasoning controls through `providerOptions` when they are not represented by the standardized `reasoning` levels.

### Migration

- Upgrade `ai` to v7 and any `@ai-sdk/*` providers to v4. OpenRouter users should upgrade `@openrouter/ai-sdk-provider` to v3.
- Rename `reasoningEffort` to `reasoning` in calls to `ai.generate`.
