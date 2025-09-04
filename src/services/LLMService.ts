import { JSONParseError, LanguageModelV1, TypeValidationError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider';
import { LLM_MODELS, ModelOption } from 'src/constants';
import type StewardPlugin from 'src/main';
import { jsonrepair } from 'jsonrepair';
import { logger } from 'src/utils/logger';

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
   * Get the base URL for a provider, with fallback to default
   * @param provider The provider name
   * @returns The base URL for the provider
   */
  private getProviderBaseUrl(provider: ModelOption['provider']): string | undefined {
    const providerConfig = this.plugin.settings.llm.providerConfigs[provider];

    if (providerConfig?.baseUrl) {
      return providerConfig.baseUrl;
    }

    // Fallback to deprecated ollamaBaseUrl for ollama provider
    if (provider === 'ollama' && this.plugin.settings.llm.ollamaBaseUrl) {
      return this.plugin.settings.llm.ollamaBaseUrl;
    }

    // Return undefined to use default base URLs from the AI SDK
    return undefined;
  }

  /**
   * Determine the provider from the model name
   * @param modelId The ID of the model
   * @returns The provider name
   */
  public getProviderFromModel(modelId: string): ModelOption['provider'] {
    const modelOption = LLM_MODELS.find(model => model.id === modelId);

    if (modelOption) {
      return modelOption.provider;
    }

    // Supports all other models
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
      return defaultProvider === 'ollama' ? 'ollama' : 'groq';
    }

    if (modelId.startsWith('deepseek')) {
      return 'deepseek';
    }

    if (modelId.startsWith('gemini')) {
      return 'google';
    }

    if (modelId.startsWith('gpt')) {
      return 'openai';
    }

    if (modelId.includes('claude')) {
      return 'anthropic';
    }

    throw new Error(`Model ${modelId} not found`);
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
    const provider = this.getProviderFromModel(model);

    let languageModel: LanguageModelV1;

    const baseURL = this.getProviderBaseUrl(provider);

    switch (provider) {
      case 'openai': {
        const openai = createOpenAI({
          ...(baseURL && { baseURL }),
        });
        languageModel = openai(model);
        break;
      }
      case 'deepseek': {
        const deepseek = createDeepSeek({
          ...(baseURL && { baseURL }),
        });
        languageModel = deepseek(model);
        break;
      }
      case 'google': {
        const google = createGoogleGenerativeAI({
          ...(baseURL && { baseURL }),
        });
        languageModel = google(model);
        break;
      }
      case 'groq': {
        const groq = createGroq({
          ...(baseURL && { baseURL }),
        });
        languageModel = groq(model);
        break;
      }
      case 'ollama': {
        const ollamaProvider = createOllama({
          ...(baseURL && { baseURL }),
        });
        languageModel = ollamaProvider(model);
        break;
      }
      case 'anthropic': {
        const anthropic = createAnthropic({
          ...(baseURL && { baseURL }),
        });
        languageModel = anthropic(model);
        break;
      }
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

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
}
