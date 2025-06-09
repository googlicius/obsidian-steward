// import { openai, openaicompatible } from 'modelfusion';
import { getProviderFromModel } from '../llmConfig';
import { intentClassifier } from './intent';

export function getClassifier(model: string, corsProxyUrl?: string) {
	const provider = getProviderFromModel(model);
	// const corsProxy = corsProxyUrl ? `${corsProxyUrl}/` : '';

	switch (provider) {
		// case 'deepseek':
		// 	return intentClassifier.withSettings({
		// 		embeddingModel: openaicompatible.TextEmbedder({
		// 			model: 'deepseek-embedding',
		// 			api: openai.Api({
		// 				baseUrl: corsProxy + 'https://api.deepseek.com/v1',
		// 				apiKey: process.env.DEEPSEEK_API_KEY,
		// 			}),
		// 		}),
		// 		modelName: 'deepseek',
		// 	});

		case 'openai':
		default:
			return intentClassifier;
	}
}
