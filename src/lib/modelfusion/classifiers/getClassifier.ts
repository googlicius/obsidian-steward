import { StewardPluginSettings } from 'src/types/interfaces';
import { intentClassifier } from './intent';
import { LLMService } from 'src/services/LLMService';

export function getClassifier(
  embeddingSettings: StewardPluginSettings['embedding'],
  isReloadRequest = false
) {
  const llmService = LLMService.getInstance();
  const { provider, modelId } = llmService.getProviderFromModel(embeddingSettings.model);

  const embeddingModel = provider.textEmbeddingModel(modelId);

  if (embeddingModel.specificationVersion === 'v3') {
    throw new Error('Embedding model specification version v3 is not supported');
  }

  return intentClassifier.withSettings({
    embeddingModel,
    modelName:
      modelId === 'text-embedding-ada-002'
        ? 'steward-intent-classifier' // Keep for back-compatibility
        : modelId,
    similarityThreshold: embeddingSettings.similarityThreshold,
    ignoreEmbedding: isReloadRequest,
  });
}
