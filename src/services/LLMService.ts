import { JSONParseError, TypeValidationError, ImageModel, SpeechModel, ModelMessage } from 'ai';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { createDeepSeek, DeepSeekProvider } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { createGroq, GroqProvider } from '@ai-sdk/groq';
import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import { createOllama, OllamaProvider } from 'ollama-ai-provider';
import { LLM_MODELS, ProviderNeedApiKey } from 'src/constants';
import type StewardPlugin from 'src/main';
import { jsonrepair } from 'jsonrepair';
import { logger } from 'src/utils/logger';
import { StewardPluginSettings } from 'src/types/interfaces';
import { getTranslation } from 'src/i18n';

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
   * Get the base URL for a provider
   * @param provider The provider name
   * @returns The base URL for the provider
   */
  public getProviderBaseUrl(provider: string): string | undefined {
    // Check providers first (new location)
    if (this.plugin.settings.providers[provider]?.baseUrl) {
      return this.plugin.settings.providers[provider].baseUrl;
    }

    // Return undefined to use default base URLs from the AI SDK
    return undefined;
  }

  /**
   * Get the decrypted API key for a provider
   * @param provider The provider name
   * @returns The decrypted API key or undefined
   */
  public getApiKey(provider: ProviderNeedApiKey): string | undefined {
    try {
      if (!this.plugin.settings.providers[provider]) {
        return undefined;
      }
      const encryptedKey = this.plugin.settings.providers[provider].apiKey;
      if (!encryptedKey) {
        return undefined;
      }
      return this.plugin.encryptionService.getDecryptedApiKey(provider);
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

    // Get baseURL for the provider (users can include CORS proxy in baseURL if needed)
    const baseURL = this.getProviderBaseUrl(name);
    const apiKey = this.getApiKey(name as ProviderNeedApiKey);

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

    if (languageModel.specificationVersion === 'v1') {
      throw new Error(`Language model ${model} is not supported`);
    }

    const generateParams = {
      model: languageModel,
      temperature,
      maxOutputTokens: maxGenerationTokens,
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
    let imageModel: ImageModel | undefined;

    if (result.name === 'openai') {
      imageModel = result.provider.image(result.modelId);
    } else if (result.provider.imageModel) {
      const imageModelV1OrV2 = result.provider.imageModel(result.modelId);
      if (imageModelV1OrV2.specificationVersion === 'v2') {
        imageModel = imageModelV1OrV2;
      }
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

    const result = this.getProviderFromModel(`${provider}:${model}`);
    let speechModel: SpeechModel | undefined;

    if (result.name === 'openai') {
      speechModel = result.provider.speech(result.modelId);
    } else if (result.provider.speechModel) {
      const speechModelV1OrV2 = result.provider.speechModel(result.modelId);
      if (speechModelV1OrV2.specificationVersion === 'v2') {
        speechModel = speechModelV1OrV2;
      }
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
  public validateImageSupport(model: string, messages: ModelMessage[], lang?: string | null): void {
    if (!this.messagesContainImages(messages)) {
      return; // No images, no validation needed
    }

    const { name: providerName, modelId } = this.getProviderFromModel(model);

    if (!this.modelSupportsVision(providerName, modelId)) {
      const t = getTranslation(lang);
      throw new Error(t('common.modelDoesNotSupportImageInputs', { model: modelId }));
    }
  }
}
