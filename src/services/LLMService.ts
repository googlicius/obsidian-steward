import { LanguageModelV1 } from 'ai';
import { openai } from '@ai-sdk/openai';
import { deepseek } from '@ai-sdk/deepseek';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { ollama } from 'ollama-ai-provider';
import { LLM_MODELS, ModelOption } from 'src/constants';
import type StewardPlugin from 'src/main';

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
    if (!LLMService.instance) {
      if (!plugin) {
        throw new Error('Plugin is required to create an instance of LLMService');
      }
      LLMService.instance = new LLMService(plugin);
    }
    return LLMService.instance;
  }

  /**
   * Determine the provider from the model name
   * @param modelId The ID of the model
   * @returns The provider name
   */
  public getProviderFromModel(modelId: string): ModelOption['provider'] {
    const modelOption = LLM_MODELS.find(model => model.id === modelId);

    if (!modelOption) {
      throw new Error(`Model ${modelId} not found`);
    }

    return modelOption.provider;
  }

  /**
   * Generate text using the AI package's generateObject function
   * @param options Options for object generation
   * @returns The result of the object generation
   */
  public async getLLMConfig(overrideModel?: string) {
    const { model: defaultModel, temperature, maxGenerationTokens } = this.plugin.settings.llm;
    const model = overrideModel || defaultModel;
    const provider = this.getProviderFromModel(model);

    let languageModel: LanguageModelV1;

    switch (provider) {
      case 'openai':
        languageModel = openai(model);
        break;
      case 'deepseek':
        languageModel = deepseek(model);
        break;
      case 'google':
        languageModel = google(model);
        break;
      case 'groq':
        languageModel = groq(model);
        break;
      case 'ollama':
        languageModel = ollama(model);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    const mergedOptions = {
      model: languageModel,
      temperature,
      maxTokens: maxGenerationTokens,
    };

    return mergedOptions;
  }
}
