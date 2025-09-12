import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { intentClassifier } from './intent';
import { LLMService } from 'src/services/LLMService';
import { ModelOption } from 'src/constants';

export function getClassifier(embeddingModel: string, isReloadRequest = false) {
  const [provider, modelId] = embeddingModel.split(':');
  const llmService = LLMService.getInstance();

  const baseURL = llmService.getProviderBaseUrl(provider as ModelOption['provider']);

  switch (provider) {
    case 'google': {
      const google = createGoogleGenerativeAI({
        ...(baseURL && { baseURL }),
      });
      return intentClassifier.withSettings({
        embeddingModel: google.textEmbeddingModel(modelId),
        modelName: modelId,
        similarityThreshold: 0.7,
        ignoreEmbedding: isReloadRequest,
      });
    }

    case 'openai':
    default: {
      const openai = createOpenAI({
        ...(baseURL && { baseURL }),
      });
      return intentClassifier.withSettings({
        embeddingModel: openai.textEmbeddingModel(modelId),
        modelName: 'steward-intent-classifier', // Keep for back-compatibility
        ignoreEmbedding: isReloadRequest,
      });
    }
  }
}
