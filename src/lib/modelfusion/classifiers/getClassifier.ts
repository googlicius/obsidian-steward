import { StewardPluginSettings } from 'src/types/interfaces';
import { intentClassifier } from './intent';
import { LLMService } from 'src/services/LLMService';

export function getClassifier(
  embeddingSettings: StewardPluginSettings['embedding'],
  isReloadRequest = false
) {
  const llmService = LLMService.getInstance();
  const { provider, modelId } = llmService.getProviderFromModel(embeddingSettings.model);

  if (!('embeddingModel' in provider)) {
    throw new Error(`Embedding is not supported for provider: ${provider.name}`);
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
