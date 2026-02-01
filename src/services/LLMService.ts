import {
  JSONParseError,
  ImageModel,
  SpeechModel,
  ModelMessage,
  LanguageModel,
  ToolCallPart,
  InvalidToolInputError,
  NoSuchToolError,
} from 'ai';
import type { OpenAIProvider } from '@ai-sdk/openai';
import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import type { DeepSeekProvider } from '@ai-sdk/deepseek';
import type { GoogleGenerativeAIProvider } from '@ai-sdk/google';
import type { GroqProvider } from '@ai-sdk/groq';
import type { ElevenLabsProvider } from '@ai-sdk/elevenlabs';
import type { HumeProvider } from '@ai-sdk/hume';
import type { AnthropicProvider } from '@ai-sdk/anthropic';
import type { OllamaProvider } from 'ollama-ai-provider-v2';
import type StewardPlugin from 'src/main';
import { jsonrepair } from 'jsonrepair';
import { logger } from 'src/utils/logger';
import { StewardPluginSettings } from 'src/types/interfaces';
import { getTranslation } from 'src/i18n';
import { getCdnLib } from 'src/utils/cdnUrls';
import { fixUnquotedJSON } from 'src/utils/jsonRepairs';

/**
 * Service for managing LLM models and configurations using the AI package
 */
export class LLMService {
  private static instance: LLMService | null = null;

  private constructor(private plugin: StewardPlugin) {}

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
   * Determine the provider from the model name
   * Supports both built-in providers and custom providers (using compatibility)
   */
  // Overload for ElevenLabs provider
  public async getProviderFromModel(model: `elevenlabs:${string}`): Promise<{
    modelId: string;
    name: 'elevenlabs';
    systemPrompt?: string;
    provider: ElevenLabsProvider;
  }>;
  // Overload for Hume provider
  public async getProviderFromModel(model: `hume:${string}`): Promise<{
    modelId: string;
    name: 'hume';
    systemPrompt?: string;
    provider: HumeProvider;
  }>;
  // Overload for other providers (excluding ElevenLabs)
  public async getProviderFromModel(model: string | `${string}:${string}`): Promise<{
    modelId: string;
    name: string;
    systemPrompt?: string;
    provider:
      | OpenAIProvider
      | OpenAICompatibleProvider
      | DeepSeekProvider
      | GoogleGenerativeAIProvider
      | GroqProvider
      | OllamaProvider
      | AnthropicProvider;
  }>;
  // Implementation
  public async getProviderFromModel(model: string | `${string}:${string}`): Promise<{
    modelId: string;
    name: string;
    systemPrompt?: string;
    provider:
      | OpenAIProvider
      | OpenAICompatibleProvider
      | DeepSeekProvider
      | GoogleGenerativeAIProvider
      | GroqProvider
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
      | DeepSeekProvider
      | GoogleGenerativeAIProvider
      | GroqProvider
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
          const openaiCompatibleLib = await getCdnLib('openaiCompatible');
          provider = openaiCompatibleLib.createOpenAICompatible({
            baseURL,
            name: config.name as string,
            ...(apiKey && { apiKey }),
          });
        } else {
          const openaiLib = await getCdnLib('openai');
          provider = openaiLib.createOpenAI({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          });
        }
        break;
      }

      case 'deepseek': {
        const deepSeekLib = await getCdnLib('deepseek');
        provider = deepSeekLib.createDeepSeek({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });
        break;
      }

      case 'google': {
        const googleLib = await getCdnLib('google');
        provider = googleLib.createGoogleGenerativeAI({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });
        break;
      }

      case 'groq': {
        const groqLib = await getCdnLib('groq');
        provider = groqLib.createGroq({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });
        break;
      }

      case 'ollama': {
        const ollamaLib = await getCdnLib('ollama');
        provider = ollamaLib.createOllama({
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
        const anthropicLib = await getCdnLib('anthropic');
        provider = anthropicLib.createAnthropic({
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
        const elevenLabsLib = await getCdnLib('elevenLabs');
        provider = elevenLabsLib.createElevenLabs({
          ...(baseURL && { baseURL }),
          ...(apiKey && { apiKey }),
        });

        break;
      }

      case 'hume': {
        const humeLib = await getCdnLib('hume');
        provider = humeLib.createHume({
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
    options: { overrideModel?: string; generateType?: 'text' | 'object' } = {}
  ) {
    const { generateType = 'object', overrideModel } = options;

    const {
      model: defaultModel,
      temperature,
      maxGenerationTokens,
    } = {
      model: this.plugin.settings.llm.chat.model,
      temperature: this.plugin.settings.llm.temperature,
      maxGenerationTokens: this.plugin.settings.llm.maxGenerationTokens,
    };
    const model = overrideModel || defaultModel;
    const { provider, modelId, systemPrompt, name } = await this.getProviderFromModel(model);

    if (['elevenlabs', 'hume'].includes(name)) {
      throw new Error(
        `${name} provider does not support language models. Use it for speech generation only.`
      );
    }

    const languageModel = provider(modelId);

    const generateParams = {
      model: languageModel as LanguageModel,
      temperature,
      maxOutputTokens: maxGenerationTokens,
      systemPrompt,
      repairToolCall: async (options: {
        toolCall: ToolCallPart;
        error: JSONParseError | InvalidToolInputError | NoSuchToolError;
      }) => {
        if (options.error instanceof InvalidToolInputError) {
          try {
            logger.log('Repairing invalid tool call input', options.error);
            options.toolCall.input = jsonrepair(options.toolCall.input as string);
          } catch (error) {
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
  private modelSupportsVision(providerName: string, modelId: string): boolean {
    const modelIdLower = modelId.toLowerCase();

    switch (providerName) {
      case 'openai':
        // GPT-4 models with vision support
        return (
          modelIdLower.includes('gpt-4o') ||
          modelIdLower.includes('gpt-4-turbo') ||
          modelIdLower.includes('gpt-4-vision') ||
          modelIdLower.includes('gpt-4-0125') ||
          modelIdLower.includes('gpt-4-1106')
        );

      case 'google':
        // Gemini models generally support vision
        return (
          modelIdLower.includes('gemini') ||
          modelIdLower.includes('gemini-pro') ||
          modelIdLower.includes('gemini-1.5') ||
          modelIdLower.includes('gemini-2')
        );

      case 'anthropic':
        // Claude 3+ models support vision
        return (
          modelIdLower.includes('claude-3') ||
          modelIdLower.includes('claude-sonnet-4') ||
          modelIdLower.includes('claude-opus') ||
          modelIdLower.includes('claude-haiku')
        );

      case 'deepseek':
        // DeepSeek-V2 and newer support vision
        return modelIdLower.includes('deepseek-v2');

      case 'groq':
      case 'ollama':
        // These providers depend on the specific model, but many don't support vision
        // We'll be conservative and return false unless explicitly known
        return false;

      default:
        return false;
    }
  }

  /**
   * Check if messages contain image parts
   */
  private messagesContainImages(messages: ModelMessage[]): boolean {
    for (const message of messages) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part && part.type === 'image') {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Validate that the model supports image inputs if messages contain images
   * @throws Error if images are present but model doesn't support vision
   */
  public async validateImageSupport(
    model: string,
    messages: ModelMessage[],
    lang?: string | null
  ): Promise<void> {
    if (!this.messagesContainImages(messages)) {
      return; // No images, no validation needed
    }

    const { name: providerName, modelId } = await this.getProviderFromModel(model);

    if (!this.modelSupportsVision(providerName, modelId)) {
      const t = getTranslation(lang);
      throw new Error(t('common.modelDoesNotSupportImageInputs', { model: modelId }));
    }
  }
}
