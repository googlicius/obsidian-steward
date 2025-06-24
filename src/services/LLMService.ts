import { LanguageModelV1 } from 'ai';
import { openai } from '@ai-sdk/openai';
import { deepseek } from '@ai-sdk/deepseek';
import { logger } from 'src/utils/logger';
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
   * @param modelName The name of the model
   * @returns The provider name ('openai', 'ollama', 'deepseek', or 'anthropic')
   */
  public getProviderFromModel(modelName: string): 'openai' | 'ollama' | 'deepseek' | 'anthropic' {
    if (
      modelName.includes('llama') ||
      modelName.includes('mistral') ||
      modelName.includes('mixtral') ||
      modelName.includes('phi') ||
      modelName.includes('gemma')
    ) {
      return 'ollama';
    }

    if (modelName.startsWith('deepseek')) {
      return 'deepseek';
    }

    if (modelName.includes('claude')) {
      return 'anthropic';
    }

    return 'openai';
  }

  /**
   * Generate text using the AI package's generateObject function
   * @param options Options for object generation
   * @returns The result of the object generation
   */
  public async getLLMConfig() {
    const { model, temperature, maxGenerationTokens } = this.plugin.settings.llm;
    const provider = this.getProviderFromModel(model);

    // Prepare the model based on the provider
    let languageModel: LanguageModelV1;

    switch (provider) {
      case 'openai':
        languageModel = openai(model);
        break;
      case 'deepseek':
        languageModel = deepseek(model);
        break;
      case 'anthropic':
        // We'll use openai as a fallback since @ai-sdk/anthropic is not available
        logger.warn('Anthropic support is not fully implemented, using OpenAI as fallback');
        languageModel = openai(model);
        break;
      case 'ollama':
        // We'll use openai as a fallback since @ai-sdk/ollama is not available
        logger.warn('Ollama support is not fully implemented, using OpenAI as fallback');
        languageModel = openai(model);
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
