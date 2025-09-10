import { openai } from '@ai-sdk/openai';
import { PersistentEmbeddingSimilarityClassifier } from '../classify/PersistentEmbeddingSimilarityClassifier';
import { EMBEDDING_MODELS } from 'src/constants';

const [, modelId] = EMBEDDING_MODELS[0].id.split(':');

/**
 * The intent classifier instance
 */
export const intentClassifier = new PersistentEmbeddingSimilarityClassifier({
  // Default embedding model (will be overridden by getClassifier)
  embeddingModel: openai.textEmbeddingModel(modelId),

  // the threshold for the distance between the value and the cluster values:
  similarityThreshold: 0.84,

  // Static cluster values that aren't need to be embedded
  staticClusterValues: [
    {
      name: 'delete_from_artifact' as const,
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
    {
      name: 'confirm' as const,
      values: ['yes', 'no', 'confirm', 'ok', 'go ahead', 'approve', 'reject', 'proceed', 'cancel'],
    },
    {
      name: 'close' as const,
      values: ['close', 'end', 'exit', 'close the chat', 'quit'],
    },
    {
      name: 'more' as const,
      values: ['more', 'show more'],
    },
    {
      name: 'stop' as const,
      values: ['stop', 'abort'],
    },
    {
      name: 'thank_you' as const,
      values: [
        'thank you',
        'thank',
        'thanks',
        'thank you so much',
        'thanks a lot',
        'appreciate it',
        'thank you very much',
      ],
    },
    {
      name: 'help' as const,
      values: [
        'help',
        'list commands',
        'show commands',
        'available commands',
        'what commands are available',
        'what can you do',
        '?',
      ],
    },
    {
      name: 'build_search_index' as const,
      values: ['build search index', 'index my files'],
    },
  ],

  prefixedClusterValue: [
    {
      name: 'audio' as const,
      values: ['speak this', 'speak this word', 'speak this phrase', 'speak this sentence'],
    },
  ],

  clusters: [
    {
      name: 'search' as const,
      values: [
        'search for documents containing x',
        'locate notes with the keyword x',
        'list all notes about x in the folder f',
        'find all notes with the keyword x',
        'search notes with the tag y',
        'find notes with the tag y',
        'find notes created last week',
        'search for notes within the folder f',
        'search for notes under the folder f',
        'Search notes containing the keyword x',
        'Search for x',
        'search note name x',
        'find note name x',
      ],
    },
    {
      name: 'move_from_artifact' as const,
      values: [
        'move results to the f folder',
        'move the results into the f folder',
        'move these notes to the f folder',
        'move them to the f folder',
        'move them into the f folder',
        'move these notes to the f folder',
        'move it to the f folder',
        'move it into the f folder',
        'move all to the f folder',
        'move all into the f folder',
        'move all notes above to the f folder',
      ],
    },
    {
      name: 'copy_from_artifact' as const,
      values: [
        'copy results to the folder f',
        'copy these notes to the folder f',
        'copy them to the folder f',
        'copy it to the folder f',
        'copy all to the folder f',
        'copy all notes above to the folder f',
      ],
    },
    {
      name: 'update_from_artifact' as const,
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
        'i agree',
        'i disagree',
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
        'create a note titled x',
        'write a new note about x',
        'create a note with content x',
        'write a note about x',
        'create a new document about x',
        'start a new note for x',
        'create a new note named x',
        'create a new note titled x',
      ],
    },
    {
      name: 'read' as const,
      values: [
        'read this content',
        'read this code block',
        'read this table',
        'read this list',
        'read this paragraph',
        'read the table above',
        'read the text above',
        'read the code block above',
        'read the list above',
        'read the paragraph above',
        'read the entire content',
      ],
    },
    {
      name: 'read:generate' as const,
      values: [
        'What is this note about?',
        'help me summarize this note',
        'read the text above, and help me some sentences include the word "x"',
      ],
    },
    {
      name: 'read:generate:update_from_artifact' as const,
      values: ['update the list above to numbered list', 'update the list above to bullet list'],
    },
    {
      name: 'thank_you' as const,
      values: [
        'thank you for your help',
        'thanks for the assistance',
        'thank you for helping me',
        'i appreciate your help',
        'thanks for your support',
        'thank you for the information',
        'thanks for the explanation',
        'thank you for the clarification',
        'thanks for answering my question',
        'thank you for your time',
        'xin cảm ơn',
        'cảm ơn',
      ],
    },
    {
      name: 'build_search_index' as const,
      values: ['build search index', 'index my files'],
    },
  ],
});
