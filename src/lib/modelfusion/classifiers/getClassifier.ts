import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { intentClassifier } from './intent';

export function getClassifier(embeddingModel: string, isReloadRequest = false) {
  const [provider, modelId] = embeddingModel.split(':');

  switch (provider) {
    case 'google':
      return intentClassifier.withSettings({
        embeddingModel: google.textEmbeddingModel(modelId),
        modelName: modelId,
        similarityThreshold: 0.77,
        ignoreEmbedding: isReloadRequest,
      });

    case 'openai':
    default:
      return intentClassifier.withSettings({
        embeddingModel: openai.textEmbeddingModel(modelId),
        modelName: 'steward-intent-classifier', // Keep for back-compatibility
        ignoreEmbedding: isReloadRequest,
      });
  }
}
