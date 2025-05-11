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
	responseFormat?: 'json_object' | 'text';
}) {
	const provider = getProviderFromModel(config.model);

	switch (provider) {
		case 'openai':
			return openai.ChatTextGenerator({
				model: config.model as any,
				temperature: config.temperature,
				responseFormat: { type: config.responseFormat || 'json_object' },
			});
		case 'deepseek':
			return openai.ChatTextGenerator({
				model: config.model as any,
				temperature: config.temperature,
				responseFormat: { type: 'json_object' },
				api: openai.Api({
					baseUrl: 'https://api.deepseek.com/v1',
				}),
			});
		case 'ollama':
			return ollama.ChatTextGenerator({
				model: config.model,
				temperature: config.temperature,
				format: 'json',
			});
		default:
			throw new Error(`Unsupported LLM provider: ${provider}`);
	}
}
