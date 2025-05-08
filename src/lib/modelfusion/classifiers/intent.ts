import { classify, openai } from 'modelfusion';
import { PersistentEmbeddingSimilarityClassifier } from '../classify/PersistentEmbeddingSimilarityClassifier';
import { retry } from 'src/utils/retry';

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
	similarityThreshold: 0.82,

	clusters: [
		{
			name: 'search' as const,
			values: [
				'search for documents containing x',
				'locate notes with keyword x',
				'list all notes about x in folder f',
				'find all notes with the keyword x',
				'search notes with the tag y',
				'find notes with the tag y',
				'find notes created last week',
				'search for notes within folder f',
				'search for notes under folder f',
				'Search notes containing the keyword x',
			],
		},
		{
			name: 'move_from_search_result' as const,
			values: [
				'move results to folder f',
				'move these notes to folder f',
				'move them to folder f',
				'move these notes to folder f',
				'move it to folder f',
				'move all to folder f',
				'move all notes above to folder f',
			],
		},
		{
			name: 'copy_from_search_result' as const,
			values: [
				'copy results to folder f',
				'copy these notes to folder f',
				'copy them to folder f',
				'copy these notes to folder f',
				'copy it to folder f',
				'copy all to folder f',
				'copy all notes above to folder f',
			],
		},
		{
			name: 'delete_from_search_result' as const,
			values: [
				'Delete them',
				'Delete it',
				'Delete all',
				'Remove them',
				'Remove it',
				'Remove all',
				'Delete the search results',
				'Delete all notes above',
			],
		},
		{
			name: 'update_from_search_result' as const,
			values: [
				'update the tag y to y',
				'remove the tag y',
				'remove the word "x" from search results',
				'remove the tag y in the search results',
				'remove the tag y from all notes above',
				'update text in these documents',
				'modify these search results by x',
				'update them by x',
				'add tag y to these files',
				'replace the word "x" with "x" in these notes',
				'replace the tag y with y',
				'add tag y to all notes above',
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
			name: 'more' as const,
			values: ['more', 'show more'],
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
				'generate an image of x',
				'create picture of x',
				'make an image showing x',
				'create an illustration of x',
				'generate a diagram of x',
				'create a visual representation of x',
				'make a picture depicting x',
				'generate artwork of x',
				'create an image for x',
			],
		},
		{
			name: 'audio' as const,
			values: [
				'generate audio of x',
				'create voice recording saying x',
				'make audio clip of x',
				'generate spoken version of x',
				'convert text to speech',
				'create audio narration of x',
				'generate voice message saying x',
				'make audio recording of x',
				'convert to audio',
			],
		},
	],
});

// Initialize embeddings
retry(
	() =>
		classify({
			model: intentClassifier,
			value: 'initialize',
		}),
	{
		initialDelay: 500,
	}
);
