import { PersistentEmbeddingSimilarityClassifier } from '../classify/PersistentEmbeddingSimilarityClassifier';
import { EMBEDDING_MODELS } from 'src/constants';
import { getCdnLib } from 'src/utils/cdnUrls';

const [, modelId] = EMBEDDING_MODELS[0].id.split(':');

let cachedIntentClassifier: PersistentEmbeddingSimilarityClassifier | null = null;

/**
 * Get the intent classifier instance (loaded from CDN)
 */
export async function getIntentClassifier(): Promise<PersistentEmbeddingSimilarityClassifier> {
  if (cachedIntentClassifier) {
    return cachedIntentClassifier;
  }

  const { openai } = await getCdnLib('openai');
  const classifier = new PersistentEmbeddingSimilarityClassifier({
  // Default embedding model (will be overridden by getClassifier)
  embeddingModel: openai.embeddingModel(modelId),

  // the threshold for the distance between the value and the cluster values:
  similarityThreshold: 0.84,

  // Static cluster values that aren't need to be embedded
  staticClusterValues: [
    {
      name: 'vault' as const,
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
      name: 'user_confirm' as const,
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
        'help me',
        'list commands',
        'show commands',
        'available commands',
        'what commands are available',
        '?',
      ],
    },
    {
      name: 'test' as const,
      values: [
        'test tool calls',
        'test ai sdk',
        'run tool test',
        'test ai tools',
        'test sdk tools',
        'run test tools',
      ],
    },
    {
      name: 'build_search_index' as const,
      values: ['build search index', 'index my files'],
    },
    {
      name: 'revert' as const,
      values: ['revert', 'undo', 'rollback'],
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
      name: 'edit' as const,
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
      name: 'user_confirm' as const,
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
        'revert',
        'rollback changes',
        'revert last operation',
        'undo the last action',
        'restore previous version',
        'cancel last change',
        'revert the deletion',
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
      name: 'speech' as const,
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
  cachedIntentClassifier = classifier;
  return classifier;
}
