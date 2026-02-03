import { StewardPluginSettings } from 'src/types/interfaces';
import { getIntentClassifier } from './intent';
import { LLMService } from 'src/services/LLMService';
import { logger } from 'src/utils/logger';

export async function getClassifier(
  embeddingSettings: StewardPluginSettings['embedding'],
  isReloadRequest = false
) {
  const llmService = LLMService.getInstance();
  const [providerResult, intentClassifier] = await Promise.all([
    llmService.getProviderFromModel(embeddingSettings.model),
    getIntentClassifier(),
  ]);
  const { provider, modelId } = providerResult;

  // If embedding is disabled or provider doesn't support embeddings, use offline mode (static clusters only)
  if (!embeddingSettings.enabled || !('embeddingModel' in provider)) {
    if (!embeddingSettings.enabled) {
      logger.log('Embedding is disabled. Using static clusters only.');
    } else {
      logger.warn(
        `Embedding is not supported for provider: ${provider.name}. Using static clusters only.`
      );
    }
    return intentClassifier.withSettings({
      // Keep the default embedding model from intentClassifier (won't be used)
      // Set ignoreEmbedding to true so it only uses static clusters and prefixed clusters
      ignoreEmbedding: true,
      similarityThreshold: embeddingSettings.similarityThreshold,
    });
  }

  const embeddingModel = provider.embeddingModel(modelId);

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
