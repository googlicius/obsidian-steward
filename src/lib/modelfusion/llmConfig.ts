import { openai, ollama } from 'modelfusion';

// Function to determine provider from model name
function getProviderFromModel(modelName: string): 'openai' | 'ollama' {
	// Check if it's an Ollama model
	if (
		modelName.includes('llama') ||
		modelName.includes('mistral') ||
		modelName.includes('mixtral') ||
		modelName.includes('phi') ||
		modelName.includes('gemma') ||
		modelName.includes('deepseek')
	) {
		return 'ollama';
	}

	// Default to OpenAI
	return 'openai';
}

// Factory function to create the appropriate model generator
export function createLLMGenerator(config: {
	model: string;
	temperature?: number;
	ollamaBaseUrl?: string;
}) {
	// Determine provider from model name
	const provider = getProviderFromModel(config.model);

	switch (provider) {
		case 'openai':
			return openai.ChatTextGenerator({
				model: config.model as any, // Type assertion needed as model names are not properly typed
				temperature: config.temperature,
				responseFormat: { type: 'json_object' },
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
