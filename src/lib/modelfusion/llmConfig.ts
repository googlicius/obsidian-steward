import { openai, ollama, openaicompatible, OpenAIChatModelType } from 'modelfusion';
import { StewardPluginSettings } from 'src/types/interfaces';
import { OpenAIChatModel } from './overridden/OpenAIChatModel';

export function getProviderFromModel(modelName: string): 'openai' | 'ollama' | 'deepseek' {
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

  return 'openai';
}

export function createLLMGenerator(
  config: StewardPluginSettings['llm'] & { responseFormat?: 'json_object' | 'text' }
) {
  const provider = getProviderFromModel(config.model);
  const { model, temperature, maxGenerationTokens, responseFormat = 'json_object' } = config;

  switch (provider) {
    case 'openai': {
      return new OpenAIChatModel({
        model: model as OpenAIChatModelType,
        temperature,
        maxGenerationTokens,
        responseFormat: { type: responseFormat },
      });
    }
    case 'deepseek': {
      const corsProxy = config.corsProxyUrl ? `${config.corsProxyUrl.replace(/\/$/, '')}/` : '';
      return openaicompatible.ChatTextGenerator({
        model,
        temperature,
        maxGenerationTokens,
        responseFormat: { type: responseFormat },
        api: openai.Api({
          baseUrl: corsProxy + 'https://api.deepseek.com/v1',
          apiKey: process.env.DEEPSEEK_API_KEY,
        }),
      });
    }
    case 'ollama':
      return ollama.ChatTextGenerator({
        model,
        temperature,
        maxGenerationTokens,
        format: responseFormat === 'json_object' ? 'json' : undefined,
      });
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
