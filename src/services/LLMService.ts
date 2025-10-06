import { JSONParseError, TypeValidationError, ImageModel, SpeechModel } from 'ai';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { createDeepSeek, DeepSeekProvider } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { createGroq, GroqProvider } from '@ai-sdk/groq';
import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import { createOllama, OllamaProvider } from 'ollama-ai-provider';
import { LLM_MODELS } from 'src/constants';
import type StewardPlugin from 'src/main';
import { jsonrepair } from 'jsonrepair';
import { logger } from 'src/utils/logger';
import { StewardPluginSettings } from 'src/types/interfaces';

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
   * Get the base URL for a provider, with fallback to default
   * @param provider The provider name
   * @returns The base URL for the provider
   */
  public getProviderBaseUrl(provider: string): string | undefined {
    const providerConfig = this.plugin.settings.llm.providerConfigs[provider];

    if (providerConfig?.baseUrl) {
      return providerConfig.baseUrl;
    }

    // Return undefined to use default base URLs from the AI SDK
    return undefined;
  }

  /**
   * Get the decrypted API key for a provider
   * @param provider The provider name
   * @returns The decrypted API key or undefined
   */
  public getApiKey(provider: keyof StewardPluginSettings['apiKeys']): string | undefined {
    try {
      const encryptedKey = this.plugin.settings.apiKeys[provider];
      if (!encryptedKey) {
        return undefined;
      }
      return this.plugin.getDecryptedApiKey(provider);
    } catch (error) {
      logger.error(`Error getting API key for ${provider}:`, error);
      return undefined;
    }
  }

  /**
   * Determine the provider from the model name
   */
  public getProviderFromModel(
    model: string | `${string}:${string}`
  ):
    | { modelId: string; name: 'openai'; provider: OpenAIProvider }
    | { modelId: string; name: 'deepseek'; provider: DeepSeekProvider }
    | { modelId: string; name: 'google'; provider: GoogleGenerativeAIProvider }
    | { modelId: string; name: 'groq'; provider: GroqProvider }
    | { modelId: string; name: 'ollama'; provider: OllamaProvider }
    | { modelId: string; name: 'anthropic'; provider: AnthropicProvider } {
    let name: string | null = null;
    let modelId = model;

    if (model.includes(':')) {
      const [provider, id] = model.split(':');
      name = provider;
      modelId = id;
    }

    // Supports all other models
    if (!name) {
      if (
        model.includes('llama') ||
        model.includes('mistral') ||
        model.includes('mixtral') ||
        model.includes('phi') ||
        model.includes('gemma') ||
        model.includes('qwen')
      ) {
        // Check if the settings model is in LLM_MODELS to determine default provider
        const settingsModelOption = LLM_MODELS.find(
          model => model.id === this.plugin.settings.llm.chat.model
        );
        const defaultProvider = settingsModelOption?.id.split(':')[0];
        name = defaultProvider === 'ollama' ? 'ollama' : 'groq';
      }

      // For legacy models
      if (model.startsWith('deepseek')) {
        name = 'deepseek';
      } else if (model.startsWith('gemini')) {
        name = 'google';
      } else if (model.startsWith('gpt')) {
        name = 'openai';
      } else if (model.includes('claude')) {
        name = 'anthropic';
      }
    }

    if (!name) {
      throw new Error(`Model ${model} not found`);
    }

    const baseURL = this.getProviderBaseUrl(name);
    const apiKey = this.getApiKey(name as keyof StewardPluginSettings['apiKeys']);

    switch (name) {
      case 'openai': {
        return {
          modelId,
          name,
          provider: createOpenAI({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          }),
        };
      }

      case 'deepseek': {
        return {
          modelId,
          name,
          provider: createDeepSeek({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          }),
        };
      }

      case 'google': {
        return {
          modelId,
          name,
          provider: createGoogleGenerativeAI({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          }),
        };
      }

      case 'groq': {
        return {
          modelId,
          name,
          provider: createGroq({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          }),
        };
      }

      case 'ollama': {
        return {
          modelId,
          name,
          provider: createOllama({
            ...(baseURL && { baseURL }),
          }),
        };
      }

      case 'anthropic': {
        return {
          modelId,
          name,
          provider: createAnthropic({
            ...(baseURL && { baseURL }),
            ...(apiKey && { apiKey }),
          }),
        };
      }

      default:
        throw new Error(`Provider ${name} not found`);
    }
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
    const { provider, modelId } = this.getProviderFromModel(model);

    const languageModel = provider(modelId);

    const generateParams = {
      model: languageModel,
      temperature,
      maxTokens: maxGenerationTokens,
    };

    if (generateType === 'text') {
      return generateParams;
    }

    return {
      ...generateParams,
      experimental_repairText: async (options: {
        text: string;
        error: JSONParseError | TypeValidationError;
      }) => {
        if (options.error instanceof JSONParseError) {
          logger.log('Repairing JSON', options.error);
          return jsonrepair(options.text);
        }

        logger.error('May be TypeValidationError', options.error);

        return options.text;
      },
    };
  }

  public async getImageConfig(options?: { overrideModel?: string }): Promise<{
    model: ImageModel;
    size: `${number}x${number}`;
  }> {
    const { overrideModel } = options || {};
    const model = overrideModel || this.plugin.settings.llm.image.model;
    const result = this.getProviderFromModel(model);
    let imageModel: ImageModel;

    if (result.name === 'openai') {
      imageModel = result.provider.image(result.modelId);
    } else if (result.provider.imageModel) {
      imageModel = result.provider.imageModel(result.modelId);
    } else {
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

    const result = this.getProviderFromModel(`${provider}:${model}`);
    let speechModel: SpeechModel;

    if (result.name === 'openai') {
      speechModel = result.provider.speech(result.modelId);
    } else if (result.provider.speechModel) {
      speechModel = result.provider.speechModel(result.modelId);
    } else {
      throw new Error(`Speech generation not supported for provider: ${result.name}`);
    }

    return {
      model: speechModel,
      voice:
        this.plugin.settings.llm.speech.voices[
          provider as keyof StewardPluginSettings['llm']['speech']['voices']
        ],
    };
  }
}
