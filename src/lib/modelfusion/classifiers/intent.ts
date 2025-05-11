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

	// Static cluster values that aren't need to be embedded
	staticClusterValues: [
		{
			name: 'delete_from_search_result' as const,
			values: [
				'delete them',
				'delete it',
				'delete all',
				'remove them',
				'remove it',
				'remove all',
				'delete the search results',
				'delete all notes above',
			],
		},
	],

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
				'Search for x',
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
				'speak this x',
			],
		},
		{
			name: 'prompt' as const,
			values: [
				'create a new prompt for x',
				'make a prompt that does x',
				'generate a prompt for x',
				'create custom prompt for x',
				'add new prompt for x',
				'define a prompt that x',
				'create prompt template for x',
				'add prompt command for x',
				'create new command prompt for x',
			],
		},
		{
			name: 'create' as const,
			values: [
				'create a new note about x',
				'make a note for x',
				'create a note titled x',
				'write a new note about x',
				'create a new file for x',
				'make a new note with x',
				'create a note with content x',
				'write a note about x',
				'create a new document about x',
				'start a new note for x',
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
