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
	similarityThreshold: 0.9,

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
				'Search "keyword"',
			],
		},
		{
			name: 'move' as const,
			values: [
				'move a specific note name into a specific folder',
				'move documents containing specific keywords to a specific folder',
				'move notes with specific tags to a specific folder',
				'move notes with a specific tag to a specific folder',
				'move notes containing specific keywords to a specific folder',
				'move notes created last week to a specific folder',
				'organize documents by moving them to a specific folder',
			],
		},
		{
			name: 'move_from_search_result' as const,
			values: [
				'move results to a specific directory',
				'move these notes to a specific folder',
				'move them to a specific directory',
				'move these notes to a specific folder',
				'move it to a specific folder',
				'move all to a specific folder',
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
			values: ['delete notes in the Trash folder'],
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
				'search all notes with a specific keyword and update them by adding, removing, or replacing specific tags, or keywords',
				'search all notes with a specific tag and update them by adding, removing, or replacing specific tags, or keywords',
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
