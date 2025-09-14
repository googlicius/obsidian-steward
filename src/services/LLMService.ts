import { JSONParseError, TypeValidationError, ImageModel, SpeechModel } from 'ai';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { createDeepSeek, DeepSeekProvider } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { createGroq, GroqProvider } from '@ai-sdk/groq';
import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic';
import { createOllama, OllamaProvider } from 'ollama-ai-provider';
import { LLM_MODELS, ModelOption } from 'src/constants';
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
   * Get the embedding model from settings
   * @returns The embedding model string
   */
  public getEmbeddingModel(): string {
    return this.plugin.settings.llm.embeddingModel;
  }

  /**
   * Get the base URL for a provider, with fallback to default
   * @param provider The provider name
   * @returns The base URL for the provider
   */
  public getProviderBaseUrl(provider: ModelOption['provider']): string | undefined {
    const providerConfig = this.plugin.settings.llm.providerConfigs[provider];

    if (providerConfig?.baseUrl) {
      return providerConfig.baseUrl;
    }

    // Return undefined to use default base URLs from the AI SDK
    return undefined;
  }

  /**
   * Determine the provider from the model name
   * @param modelId The ID of the model
   */
  public getProviderFromModel(
    modelId: string | `${string}:${string}`
  ):
    | { name: 'openai'; provider: OpenAIProvider }
    | { name: 'deepseek'; provider: DeepSeekProvider }
    | { name: 'google'; provider: GoogleGenerativeAIProvider }
    | { name: 'groq'; provider: GroqProvider }
    | { name: 'ollama'; provider: OllamaProvider }
    | { name: 'anthropic'; provider: AnthropicProvider } {
    const modelOption = LLM_MODELS.find(model => model.id === modelId);

    let name: ModelOption['provider'] | null = null;

    if (modelOption) {
      name = modelOption.provider;
    }

    if (!name && modelId.includes(':')) {
      const [provider] = modelId.split(':');
      name = provider as ModelOption['provider'];
    }

    // Supports all other models
    if (!name) {
      if (
        modelId.includes('llama') ||
        modelId.includes('mistral') ||
        modelId.includes('mixtral') ||
        modelId.includes('phi') ||
        modelId.includes('gemma') ||
        modelId.includes('qwen')
      ) {
        // Check if the settings model is in LLM_MODELS to determine default provider
        const settingsModelOption = LLM_MODELS.find(
          model => model.id === this.plugin.settings.llm.model
        );
        const defaultProvider = settingsModelOption?.provider;
        name = defaultProvider === 'ollama' ? 'ollama' : 'groq';
      }

      if (modelId.startsWith('deepseek')) {
        name = 'deepseek';
      } else if (modelId.startsWith('gemini')) {
        name = 'google';
      } else if (modelId.startsWith('gpt')) {
        name = 'openai';
      } else if (modelId.includes('claude')) {
        name = 'anthropic';
      }
    }

    if (!name) {
      throw new Error(`Model ${modelId} not found`);
    }

    const baseURL = this.getProviderBaseUrl(name);

    switch (name) {
      case 'openai': {
        return {
          name,
          provider: createOpenAI({
            ...(baseURL && { baseURL }),
          }),
        };
      }

      case 'deepseek': {
        return {
          name,
          provider: createDeepSeek({
            ...(baseURL && { baseURL }),
          }),
        };
      }

      case 'google': {
        return {
          name,
          provider: createGoogleGenerativeAI({
            ...(baseURL && { baseURL }),
          }),
        };
      }

      case 'groq': {
        return {
          name,
          provider: createGroq({
            ...(baseURL && { baseURL }),
          }),
        };
      }

      case 'ollama': {
        return {
          name,
          provider: createOllama({
            ...(baseURL && { baseURL }),
          }),
        };
      }

      case 'anthropic': {
        return {
          name,
          provider: createAnthropic({
            ...(baseURL && { baseURL }),
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

    const { model: defaultModel, temperature, maxGenerationTokens } = this.plugin.settings.llm;
    const model = overrideModel || defaultModel;
    const { provider } = this.getProviderFromModel(model);

    const languageModel = provider(model);

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
    const { model: defaultModel } = this.plugin.settings.llm;
    const model = overrideModel || defaultModel;
    const result = this.getProviderFromModel(model);
    let imageModel: ImageModel;

    if (result.name === 'openai') {
      imageModel = result.provider.image(model);
    } else if (result.provider.imageModel) {
      imageModel = result.provider.imageModel(model);
    } else {
      throw new Error(`Image generation not supported for provider: ${result.name}`);
    }

    return {
      model: imageModel,
      size: '1024x1024',
    };
  }

  public async getSpeechConfig(options?: { overrideModel?: string }) {
    const { overrideModel } = options || {};

    // Use speech-specific model from settings
    const speechModelId = overrideModel || this.plugin.settings.llm.speech.model;
    const [provider, model] = speechModelId.split(':');

    console.log('speechModelId', speechModelId);

    const result = this.getProviderFromModel(`${provider}:${model}`);
    let speechModel: SpeechModel;

    if (result.name === 'openai') {
      speechModel = result.provider.speech(model);
    } else if (result.provider.speechModel) {
      speechModel = result.provider.speechModel(model);
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
