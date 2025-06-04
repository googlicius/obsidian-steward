import { openai, ollama } from 'modelfusion';

function getProviderFromModel(modelName: string): 'openai' | 'ollama' | 'deepseek' {
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

export function createLLMGenerator(config: {
	model: string;
	temperature?: number;
	ollamaBaseUrl?: string;
	maxGenerationTokens?: number;
	responseFormat?: 'json_object' | 'text';
}) {
	const provider = getProviderFromModel(config.model);
	const { model, temperature, maxGenerationTokens, responseFormat = 'json_object' } = config;

	switch (provider) {
		case 'openai':
			return openai.ChatTextGenerator({
				model: model as any,
				temperature,
				maxGenerationTokens,
				// topP: config.topP,
				responseFormat: { type: responseFormat },
			});
		case 'deepseek':
			return openai.ChatTextGenerator({
				model: model as any,
				temperature,
				maxGenerationTokens,
				responseFormat: { type: responseFormat },
				api: openai.Api({
					baseUrl: 'https://api.deepseek.com/v1',
				}),
			});
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
