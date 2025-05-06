import { classify, openai } from 'modelfusion';
import { PersistentEmbeddingSimilarityClassifier } from '../classify/PersistentEmbeddingSimilarityClassifier';
import { executeWithInitialDelay, withApiRetry } from 'src/utils/retryUtils';
import { logger } from 'src/utils/logger';

/**
 * The intent classifier instance
 */
export const intentClassifier = new PersistentEmbeddingSimilarityClassifier({
	// you can use any supported embedding model:
	embeddingModel: openai.TextEmbedder({
		model: 'text-embedding-ada-002',
	}),

	// Custom model name for storage
	modelName: 'steward-intent-classifier',

	// the threshold for the distance between the value and the cluster values:
	similarityThreshold: 0.8,

	clusters: [
		{
			name: 'search' as const,
			values: [
				'search for documents containing',
				'locate notes with keyword',
				'list all notes about in a specific folder',
				'find all notes with a specific keyword',
				'search notes with a specific tag',
				'find notes created last week',
				'search for notes within a specific folder',
			],
		},
		{
			name: 'move' as const,
			values: [
				'move notes about project to folder',
				'organize files with tag into directory',
				'move documents containing keyword to',
				'reorganize notes with topic into folder',
				'move all files with tag to directory',
				'relocate notes containing text to folder',
				'move files created last week to directory',
				'organize documents by moving them to folder',
			],
		},
		{
			name: 'copy' as const,
			values: [
				'copy notes about project to folder',
				'duplicate files with tag to directory',
				'copy documents containing keyword to',
				'duplicate notes with topic to folder',
				'copy all files with tag to directory',
				'duplicate notes containing text to folder',
				'copy files created last week to directory',
				'make copies of documents in folder',
			],
		},
		{
			name: 'delete' as const,
			values: [
				'delete notes about project',
				'remove files with tag',
				'delete documents containing keyword',
				'remove notes with topic',
				'delete all files with tag',
				'remove notes containing text',
				'delete files created last week',
				'remove empty documents',
			],
		},
		{
			name: 'move_from_search_result' as const,
			values: [
				'move these notes to folder',
				'move results to directory',
				'move these files to folder',
				'organize these search results into folder',
				'move these documents to directory',
				'relocate these search results to folder',
				'move these notes into archive',
			],
		},
		{
			name: 'update' as const,
			values: [
				'update tags in notes about project',
				'change content in files with tag',
				'update text in documents containing keyword',
				'modify notes with topic',
				'add a tag at the beginning of notes in a specific folder',
				'add a tag at the end of notes in a specific folder',
				'replace specific tags with new tags',
				'update metadata in files created last week',
				'change formatting in documents with tag',
				'remove specific tags from specific notes or files',
			],
		},
		{
			name: 'update_from_search_result' as const,
			values: [
				'update tags in these results',
				'change content in these files',
				'update text in these documents',
				'modify these search results',
				'add tag to these files',
				'replace text in these notes',
				'update metadata in these search results',
				'change formatting in these documents',
			],
		},
		{
			name: 'calc' as const,
			values: [
				'calculate',
				'compute',
				'what is the result of',
				'solve this equation',
				'calculate the sum of',
				'compute the average of',
				'what is the product of',
				'how much is',
				'calculate percentage of',
				'convert units',
				'what is the square root of',
			],
		},
		{
			name: 'close' as const,
			values: [
				'close',
				'close this',
				'close conversation',
				'end',
				'exit',
				'end this conversation',
				'close the chat',
				"we're done",
				"that's all for now",
				'quit',
				'terminate',
			],
		},
		{
			name: 'confirm' as const,
			values: [
				'yes',
				'no',
				'confirm',
				'deny',
				'approve',
				'reject',
				'proceed',
				'cancel',
				'go ahead',
				'stop',
				'i agree',
				'i disagree',
				"that's correct",
				"that's incorrect",
			],
		},
		{
			name: 'revert' as const,
			values: [
				'undo last change',
				'revert to previous state',
				'go back to previous version',
				'undo',
				'rollback changes',
				'revert last operation',
				'undo the last action',
				'restore previous version',
				'cancel last change',
			],
		},
		{
			name: 'image' as const,
			values: [
				'generate an image of',
				'create picture of',
				'make an image showing',
				'create an illustration of',
				'generate a diagram of',
				'create a visual representation of',
				'make a picture depicting',
				'generate artwork of',
				'create an image for',
			],
		},
		{
			name: 'audio' as const,
			values: [
				'generate audio of',
				'create voice recording saying',
				'make audio clip of',
				'generate spoken version of',
				'convert text to speech',
				'create audio narration of',
				'generate voice message saying',
				'make audio recording of',
				'convert to audio',
			],
		},
	],
});

// Initialize embeddings with retries and a delay to ensure API keys are loaded
executeWithInitialDelay(
	() =>
		withApiRetry(
			async () => {
				logger.log('Background: Starting embeddings generation');
				await classify({
					model: intentClassifier,
					value: 'initialize embeddings', // Simple text to trigger embeddings generation
				});
				logger.log('Background: Embeddings generation completed');
				return true;
			},
			{
				maxAttempts: 5,
				initialDelayMs: 3000,
				onRetry: (error, attemptNumber, delayMs) => {
					logger.log(
						`Embeddings generation attempt ${attemptNumber} failed. Retrying in ${delayMs}ms. Error: ${error?.message || error}`
					);
				},
				onSuccess: () => {
					// Do nothing
				},
			}
		),
	1000, // Initial delay of 1 second to ensure API keys are loaded
	{
		onFailure: error => {
			logger.error('Failed to initialize embeddings after multiple attempts:', error);
		},
	}
);
