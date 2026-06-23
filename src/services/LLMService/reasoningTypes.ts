import type { generateText } from 'ai';
import type { ReasoningCapability, ReasoningLevel } from 'src/types/models';

type AiGenerateTextProviderOptions = NonNullable<
  Parameters<typeof generateText>[0]['providerOptions']
>;

/**
 * Extra fields merged into AI SDK `streamText` / `generateText` for reasoning.
 *
 * Keys match the model provider prefix (`provider:modelId`) for custom OpenAI-compatible
 * providers, or the built-in provider id (`openai`, `anthropic`, `google`).
 * Capability (effort vs thinking-toggle) is resolved from hostname / built-in maps;
 * wire fields are nested under the provider name key, for example:
 * - `z.ai:GLM-5.2` with provider name `z.ai` → `providerOptions.z` (SDK uses first segment)
 * - `kimi:k2` with reasoning `none` → `providerOptions.kimi` with `thinking: { type: 'disabled' }`
 * - `kimi:k2` with reasoning enabled → `providerOptions.kimi` with `thinking: { type: 'enabled' }`
 * - `openai:gpt-5.4` → `providerOptions.openai` with `reasoningEffort`
 */
export interface ReasoningCallExtras {
  providerOptions?: AiGenerateTextProviderOptions;
}

/** Built-in or custom provider context used to resolve reasoning capability. */
export interface ReasoningProviderContext {
  /** Provider segment from the model id (`provider` in `provider:modelId`). */
  providerName: string;
  /** Built-in id or custom compatibility target (`openai`, `anthropic`, …). */
  standardName: string;
  /**
   * User-provided `name` on the custom provider config; passed to `createOpenAICompatible`.
   * Falls back to {@link providerName} when unset.
   */
  openAICompatibleName: string;
  baseUrl?: string;
  isCustom: boolean;
}

/** UI mode returned to settings when adding a custom chat model. */
export type ReasoningUiMode = 'hidden' | 'effort' | 'thinking-toggle';

export interface ReasoningUiOption {
  value: string;
  labelKey: string;
}

export interface ReasoningResolution {
  capability: ReasoningCapability;
  level: ReasoningLevel;
  extras: ReasoningCallExtras;
}
