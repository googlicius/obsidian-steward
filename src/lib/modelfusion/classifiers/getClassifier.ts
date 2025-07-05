import { intentClassifier } from './intent';
import { LLMService } from 'src/services/LLMService';

export function getClassifier(model: string) {
  const provider = LLMService.getInstance().getProviderFromModel(model);

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
