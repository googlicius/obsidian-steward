import { intentClassifier } from './intent';
import { LLMService } from 'src/services/LLMService';

export function getClassifier(embeddingModel: string, isReloadRequest = false) {
  const llmService = LLMService.getInstance();
  const { provider, modelId, name } = llmService.getProviderFromModel(embeddingModel);

  switch (name) {
    case 'google': {
      return intentClassifier.withSettings({
        embeddingModel: provider.textEmbeddingModel(modelId),
        modelName: modelId,
        similarityThreshold: 0.7,
        ignoreEmbedding: isReloadRequest,
      });
    }

    case 'openai':
    default: {
      return intentClassifier.withSettings({
        embeddingModel: provider.textEmbeddingModel(modelId),
        modelName:
          modelId === 'text-embedding-ada-002'
            ? 'steward-intent-classifier' // Keep for back-compatibility
            : modelId,
        ignoreEmbedding: isReloadRequest,
      });
    }
  }
}
