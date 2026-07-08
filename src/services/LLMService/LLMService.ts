import type StewardPlugin from 'src/main';
import { jsonrepair } from 'jsonrepair';
import { logger } from 'src/utils/logger';
import { StewardPluginSettings } from 'src/types/interfaces';
import { fixUnquotedJSON } from 'src/utils/jsonRepairs';
import { getBundledLib } from 'src/utils/bundledLibs';
import type {
  JSONParseError,
  ImageModel,
  SpeechModel,
  LanguageModel,
  ToolCallPart,
  InvalidToolInputError,
  NoSuchToolError,
} from 'ai';
import type { OpenAIProvider } from '@ai-sdk/openai';
import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import type { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import type { AnthropicProvider } from '@ai-sdk/anthropic';
import type { ElevenLabsProvider } from '@ai-sdk/elevenlabs';
import type { HumeProvider } from '@ai-sdk/hume';
import type { OllamaProvider } from 'ollama-ai-provider-v2';
import { ModelRegistry } from 'src/services/ModelRegistry';
import type { TestModelInput } from 'src/types/models';
import { ReasoningService } from 'src/services/LLMService/ReasoningService';
import { getModelMetadata } from 'src/services/LLMService/modelMetadata';

/** When model id is unknown / unmatched — compaction threshold denominator fallback */
const DEFAULT_MODEL_CONTEXT_LENGTH_FALLBACK = 128_000;
const MODEL_CONTEXT_LENGTH_DEBUG = null;

/**
 * When provider/model is unknown or has no documented prompt-cache TTL — conservative
 * 5-minute default (matches Anthropic's documented ephemeral cache TTL). Biased short:
 * reducing tool-call content too early recreates the "tampered" bug this guards against,
 * while reducing too late only wastes some tokens.
 */
const DEFAULT_PROMPT_CACHE_TTL_MS = 5 * 60_000;

const PROMPT_CACHE_TTL_DEFAULT_ENTRIES: ReadonlyArray<readonly [string, number]> = [
  ['claude', 5 * 60_000],
  ['anthropic', 5 * 60_000],
  ['gpt', 5 * 60_000],
  ['openai', 5 * 60_000],
  ['gemini', 3 * 60_000],
  ['google', 3 * 60_000],
];

/**
 * Service for managing LLM models and configurations using the AI package
 */
export class LLMService {
  private static instance: LLMService | null = null;

  /** Sorting descending by key length enforces “specific-first, generic-last” matching, same as SORTED_MODEL_CONTEXT_DEFAULTS. */
  private static readonly SORTED_PROMPT_CACHE_TTL_DEFAULTS = [
    ...PROMPT_CACHE_TTL_DEFAULT_ENTRIES,
  ].sort((a, b) => b[0].length - a[0].length);

  /** Resolves model reasoning levels into provider-specific AI SDK call extras. */
  public readonly reasoningService: ReasoningService;

  private constructor(private plugin: StewardPlugin) {
    this.reasoningService = new ReasoningService(plugin, this);
  }

  /**
   * Get the singleton instance of LLMService
   * @returns LLMService instance
   */
  public static getInstance(plugin?: StewardPlugin): LLMService {
    if (plugin) {
      LLMService.instance = new LLMService(plugin);
      return LLMService.instance;
    }
    if (!LLMService.instance) {
      throw new Error('Plugin is required to create an instance of LLMService');
    }
    return LLMService.instance;
  }

  /**
   * Get the embedding settings
   */
  public getEmbeddingSettings(): StewardPluginSettings['embedding'] {
    return this.plugin.settings.embedding;
  }

  /**
   * Get provider configuration with decrypted API key
   * @param provider The provider name (can be a key or display name)
   * @returns Provider config with decrypted API key
   */
  private getProviderInfo(provider: string): StewardPluginSettings['providers'][string] {
    // First, try to find provider directly by key
    let providerConfig = this.plugin.settings.providers[provider];
    let providerKey = provider;

    if (!providerConfig) {
      // Else find the rest - search through all providers from the end to find a match
      const providerEntries = Object.entries(this.plugin.settings.providers);
      for (let i = providerEntries.length - 1; i >= 0; i--) {
        const [key, config] = providerEntries[i];
        // Check if the provider name matches a custom provider's name field
        if (config.isCustom && config.name?.toLowerCase() === provider.toLowerCase()) {
          providerKey = key;
          providerConfig = config;
          break;
        }
      }
    }

    // If not found, throw an error
    if (!providerConfig) {
      throw new Error(`Provider ${provider} not found in settings`);
    }

    // Get decrypted API key (single call)
    let decryptedApiKey = '';
    try {
      if (providerConfig.apiKey) {
        decryptedApiKey = this.plugin.encryptionService.getDecryptedApiKey(providerKey);
      }
    } catch (error) {
      logger.error(`Error getting API key for ${providerKey}:`, error);
    }

    return {
      ...providerConfig,
      apiKey: decryptedApiKey,
    };
  }

  /**
   * Parse a model string into provider and model ID
   * Handles model IDs that contain colons (e.g., ollama:llama3.2:3b -> { provider: 'ollama', modelId: 'llama3.2:3b' })
   * @param model The model string in format provider:modelId
   * @returns An object with provider and modelId
   */
  public parseModel(model: string): { provider: string; modelId: string } {
    const colonIndex = model.indexOf(':');
    if (colonIndex === -1) {
      return { provider: '', modelId: model };
    }
    return {
      provider: model.substring(0, colonIndex),
      modelId: model.substring(colonIndex + 1),
    };
  }

  /**
   * Resolved chat context window in tokens for compaction thresholds (`provider:modelId`).
   * Optional overrides: settings.llm.modelContextLengths[`fullModelKey`].
   */
  public getModelContextLengthTokens(model: string): number {
    const trimmed = model?.trim() ?? '';
    if (!trimmed) {
      return DEFAULT_MODEL_CONTEXT_LENGTH_FALLBACK;
    }

    if (MODEL_CONTEXT_LENGTH_DEBUG) {
      return MODEL_CONTEXT_LENGTH_DEBUG;
    }

    const overrides = this.plugin.settings.llm.modelContextLengths ?? {};
    const override = overrides[trimmed];
    if (typeof override === 'number' && override > 0 && Number.isFinite(override)) {
      return Math.floor(override);
    }

    const metadataContext = getModelMetadata(trimmed)?.context;
    if (typeof metadataContext === 'number' && metadataContext > 0 && Number.isFinite(metadataContext)) {
      return Math.floor(metadataContext);
    }

    return DEFAULT_MODEL_CONTEXT_LENGTH_FALLBACK;
  }

  /**
   * Conservative estimate of the provider's prompt-cache TTL in ms for `model` (`provider:modelId`).
   * Used to decide whether a conversation's prompt cache is still likely warm since the last
   * request, so tool-call content reduction can be deferred until the cache would be cold anyway.
   */
  public getModelPromptCacheTtlMs(model: string): number {
    const trimmed = model?.trim() ?? '';
    if (!trimmed) {
      return DEFAULT_PROMPT_CACHE_TTL_MS;
    }

    const { provider, modelId } = this.parseModel(trimmed);
    const haystack = `${trimmed} ${modelId} ${provider}`.toLowerCase();

    for (const [pattern, ttlMs] of LLMService.SORTED_PROMPT_CACHE_TTL_DEFAULTS) {
      if (haystack.includes(pattern.toLowerCase())) {
        return ttlMs;
      }
    }

    return DEFAULT_PROMPT_CACHE_TTL_MS;
  }

  /**
   * Format the model to a friendly label {model} | {provider}
   */
  public formatModelLabel(model: string): string {
    if (!model) {
      return '';
    }

    const { provider, modelId } = this.parseModel(model);

    if (!provider) {
      return modelId || model;
    }

    if (!modelId) {
      return provider;
    }

    return `${modelId} | ${provider}`;
  }

  /**
   * Return display name for a model id (everything after the first colon).
   * Use this in settings/UI so model ids with colons (e.g. ollama:llama3.2:3b) are shown in full.
   */
  public getModelDisplayName(modelId: string): string {
    return this.parseModel(modelId).modelId;
  }

  /**
   * Send a minimal generation request to verify provider, credentials, and model id.
   */
  public async testModel(input: TestModelInput): Promise<void> {
    const trimmed = input.modelId?.trim() ?? '';
    if (!trimmed) {
      throw new Error('Model is required');
    }

    const { provider, modelId, name } = await this.getProviderFromModel(trimmed);

    if (['elevenlabs', 'hume'].includes(name)) {
      throw new Error(`${name} does not support chat models`);
    }

    const { generateText } = await getBundledLib('ai');
    let temperature: number | undefined;
    if (input.temperaturePolicy === 'omit') {
      temperature = undefined;
    } else if (input.temperaturePolicy === 'configurable' && input.temperature !== undefined) {
      temperature = input.temperature;
    } else if (input.temperature !== undefined) {
      temperature = input.temperature;
    } else {
      temperature = ModelRegistry.getInstance(this.plugin).resolveTemperature(
        trimmed,
        this.plugin.settings.llm.temperature
      );
    }

    const reasoning =
      input.reasoning ?? ModelRegistry.getInstance(this.plugin).resolveReasoning(trimmed);
    const reasoningCallExtras = this.reasoningService.buildCallExtras(trimmed, reasoning);

    await generateText({
      model: provider(modelId) as LanguageModel,
      prompt: 'Reply with exactly: OK',
      maxOutputTokens: 16,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(reasoningCallExtras.providerOptions
        ? { providerOptions: reasoningCallExtras.providerOptions }
        : {}),
    });
  }

  /**
   * Determine the provider from the model name
   * Supports both built-in providers and custom providers (using compatibility)
   */
  // Overload for ElevenLabs provider
  public getProviderFromModel(model: `elevenlabs:${string}`): Promise<{
    modelId: string;
    name: 'elevenlabs';
    systemPrompt?: string;
    provider: ElevenLabsProvider;
  }>;
  // Overload for Hume provider
  public getProviderFromModel(model: `hume:${string}`): Promise<{
    modelId: string;
    name: 'hume';
    systemPrompt?: string;
    provider: HumeProvider;
  }>;
  // Overload for other providers (excluding ElevenLabs)
  public getProviderFromModel(model: string): Promise<{
    modelId: string;
    name: string;
    systemPrompt?: string;
    provider:
      | OpenAIProvider
      | OpenAICompatibleProvider
      | GoogleGenerativeAIProvider
      | OllamaProvider
      | AnthropicProvider;
  }>;

  // Implementation
  public async getProviderFromModel(model: string): Promise<{
    modelId: string;
    name: string;
    systemPrompt?: string;
    provider:
      | OpenAIProvider
      | OpenAICompatibleProvider
      | GoogleGenerativeAIProvider
      | OllamaProvider
      | AnthropicProvider
      | ElevenLabsProvider
      | HumeProvider;
  }> {
    const { provider: name, modelId } = this.parseModel(model);

    if (!name) {
      throw new Error(`Model ${model} must include a provider prefix (e.g., provider:modelId)`);
    }

    // Get provider configuration with decrypted API key
    const config = this.getProviderInfo(name);
    const isCustom = config.isCustom === true;
    // Calculate standardName from compatibility or provider name
    const standardName = isCustom && config.compatibility ? config.compatibility : name;
    const baseURL = config.baseUrl;
    const apiKey = config.apiKey;
    const systemPrompt = config.systemPrompt;

    let provider:
      | OpenAIProvider
      | OpenAICompatibleProvider
      | GoogleGenerativeAIProvider
      | OllamaProvider
      | AnthropicProvider
      | ElevenLabsProvider
      | HumeProvider;

    // Use standard provider name for the switch case
    switch (standardName) {
      case 'openai': {
        // Use openai-compatible for custom providers with openai compatibility
        if (isCustom) {
          if (!baseURL) {
            throw new Error(`Custom provider ${name} with OpenAI compatibility requires a baseURL`);
          }
          const { createOpenAICompatible } = await getBundledLib('@ai-sdk/openai-compatible');
          provider = createOpenAICompatible({
            baseURL,
            name: config.name as string,
            ...(apiKey && { apiKey }),
          });
        } else {
          const { createOpenAI } = await getBundledLib('@ai-sdk/openai');
          provider = createOpenAI({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          });
        }
        break;
      }

      case 'google': {
        const { createGoogleGenerativeAI } = await getBundledLib('@ai-sdk/google');
        provider = createGoogleGenerativeAI({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });
        break;
      }

      case 'ollama': {
        const { createOllama } = await getBundledLib('ollama-ai-provider-v2');
        provider = createOllama({
          ...(baseURL && { baseURL }),
          ...(apiKey && {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          }),
        });
        break;
      }

      case 'anthropic': {
        const { createAnthropic } = await getBundledLib('@ai-sdk/anthropic');
        provider = createAnthropic({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
          headers: {
            // Enable CORS access
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        });
        break;
      }

      case 'elevenlabs': {
        const { createElevenLabs } = await getBundledLib('@ai-sdk/elevenlabs');
        provider = createElevenLabs({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });

        break;
      }

      case 'hume': {
        const { createHume } = await getBundledLib('@ai-sdk/hume');
        provider = createHume({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });
        break;
      }

      default:
        throw new Error(`Provider ${name} (standard: ${standardName}) not found`);
    }

    return {
      modelId,
      name,
      ...(systemPrompt && { systemPrompt }),
      provider,
    };
  }

  /**
   * Generate text using the AI package's generateObject function
   * @param options Options for object generation
   */
  public async getLLMConfig(
    options: {
      overrideModel?: string;
      generateType?: 'text' | 'object';
      /** When true, omit reasoning provider options (e.g. title/summary agents). */
      disableReasoning?: boolean;
    } = {}
  ) {
    const { generateType = 'object', overrideModel, disableReasoning = false } = options;

    const { model: defaultModel, maxGenerationTokens } = {
      model: this.plugin.settings.llm.chat.model,
      maxGenerationTokens: this.plugin.settings.llm.maxGenerationTokens,
    };
    const model = overrideModel || defaultModel;
    const temperature = ModelRegistry.getInstance(this.plugin).resolveTemperature(
      model,
      this.plugin.settings.llm.temperature
    );
    const { provider, modelId, systemPrompt, name } = await this.getProviderFromModel(model);

    if (['elevenlabs', 'hume'].includes(name)) {
      throw new Error(
        `${name} provider does not support language models. Use it for speech generation only.`
      );
    }

    const languageModel = provider(modelId);

    const reasoning = disableReasoning
      ? 'none'
      : ModelRegistry.getInstance(this.plugin).resolveReasoning(model);
    const reasoningCallExtras = disableReasoning
      ? {}
      : this.reasoningService.buildCallExtras(model, reasoning);

    const generateParams = {
      model: languageModel as LanguageModel,
      ...(temperature !== undefined ? { temperature } : {}),
      maxOutputTokens: maxGenerationTokens,
      systemPrompt,
      reasoning,
      reasoningCallExtras,
      repairToolCall: async (options: {
        toolCall: ToolCallPart;
        error: JSONParseError | InvalidToolInputError | NoSuchToolError;
      }) => {
        const { InvalidToolInputError } = await getBundledLib('ai');
        if (options.error instanceof InvalidToolInputError) {
          try {
            logger.log('Repairing invalid tool call input', options.error);
            options.toolCall.input = jsonrepair(options.toolCall.input as string);
          } catch {
            logger.warn('Repairing invalid tool call input failed, using fallback...');
            options.toolCall.input = fixUnquotedJSON(options.toolCall.input as string);
          }
        }
        return options.toolCall;
      },
    };

    if (generateType === 'text') {
      return generateParams;
    }

    return {
      ...generateParams,
      // experimental_repairText: async (options: {
      //   text: string;
      //   error: JSONParseError | TypeValidationError;
      // }) => {
      //   if (options.error instanceof JSONParseError) {
      //     logger.log('Repairing JSON', options.error);
      //     return jsonrepair(options.text);
      //   }

      //   logger.error('May be TypeValidationError', options.error);

      //   return options.text;
      // },
    };
  }

  public async getImageConfig(options?: { overrideModel?: string }): Promise<{
    model: ImageModel;
    size: `${number}x${number}`;
  }> {
    const { overrideModel } = options || {};
    const model = overrideModel || this.plugin.settings.llm.image.model;
    const result = await this.getProviderFromModel(model);
    let imageModel: ImageModel | undefined;

    if ('image' in result.provider) {
      imageModel = result.provider.image(result.modelId);
    } else if (result.provider.imageModel) {
      imageModel = result.provider.imageModel(result.modelId);
    }

    if (!imageModel) {
      throw new Error(`Image generation not supported for provider: ${result.name}`);
    }

    return {
      model: imageModel,
      size: this.plugin.settings.llm.image.size as `${number}x${number}`,
    };
  }

  public async getSpeechConfig(options?: { overrideModel?: string }) {
    const { overrideModel } = options || {};

    // Use speech-specific model from settings
    const speechModelId = overrideModel || this.plugin.settings.llm.speech.model;
    const [provider, model] = speechModelId.split(':');

    const result = await this.getProviderFromModel(`${provider}:${model}`);
    let speechModel: SpeechModel | undefined;

    if ('speech' in result.provider) {
      speechModel = result.provider.speech(result.modelId);
    } else if (result.provider.speechModel) {
      speechModel = result.provider.speechModel(result.modelId);
    }

    if (!speechModel) {
      throw new Error(
        `Speech generation not supported for provider: ${result.name} ${result.modelId}`
      );
    }

    return {
      model: speechModel,
      voice:
        this.plugin.settings.llm.speech.voices[
          provider as keyof StewardPluginSettings['llm']['speech']['voices']
        ],
    };
  }

  /**
   * Check if a model/provider supports vision/image inputs
   */
  public supportsVision(model: string): boolean {
    return getModelMetadata(model)?.input.includes('image') ?? false;
  }
}
