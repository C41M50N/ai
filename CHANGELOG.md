# Changelog

## Unreleased

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
