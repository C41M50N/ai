# Changelog

## 3.0.0 - Unreleased

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
