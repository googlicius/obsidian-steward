import { generateObject } from 'ai';
import { getCommandIntentPrompt } from '../prompts/commandIntentPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';
import { getClassifier } from '../classifiers/getClassifier';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { ConversationHistoryMessage, CommandIntent } from 'src/types/types';
import { explanationFragment } from '../prompts/fragments';
import { getValidCommandTypes } from '../prompts/commands';

// Use AbortService instead of a local controller
const abortService = AbortService.getInstance();

// Define valid command types
const validCommandTypes = getValidCommandTypes();

// Define the Zod schema for command intent
const commandIntentSchema = z.object({
  commandType: z
    .enum(validCommandTypes as [string, ...string[]])
    .describe(`One of the available command types.`),
  query: z.string().describe(
    `The specific query for this command and will be the input of the downstream command.
- Keep it concise and short
If the command is "read" or "create", then this is the original user's query.`
  ),
});

// Define the Zod schema for command intent extraction
const commandIntentExtractionSchema = z.object({
  commands: z.array(commandIntentSchema).max(20, 'Too many commands. Maximum allowed is 20.')
    .describe(`An array of objects, each containing commandType and query.
Analyze the query for multiple commands that should be executed in sequence.
Each command in the sequence should have its own query that will be processed by specialized handlers.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1)
    .describe(`A confidence score from 0 to 1 for the overall sequence:
- 0.0-0.3: Low confidence (ambiguous or unclear requests)
- 0.4-0.7: Medium confidence (likely, but could be interpreted differently)
- 0.8-1.0: High confidence (very clear intent)
If the confidence is low, include the commands that you are extracting in the explanation so the user decides whether to proceed or not.`),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
  queryTemplate: z
    .string()
    .optional()
    .describe(
      `A template version of the query where specific elements (tags, keywords, filenames, folders) are replaced with generic placeholders (x, y, z, f). This helps identify similar query patterns for caching purposes.`
    ),
  shortDescription: z.string().optional().describe(`A short description of the command intent.`),
  // reasoning: z
  //   .string()
  //   .describe(
  //     `Your step-by-step reasoning here (keep it concise). **Include a brief summary of the extracted user intention.**`
  //   ),
});

export type CommandIntentExtraction = z.infer<typeof commandIntentExtractionSchema>;

/**
 * Extract command intents from a general query using AI
 * @returns Extracted command types, content, and explanation
 */
export async function extractCommandIntent(args: {
  command: CommandIntent;
  conversationHistories: ConversationHistoryMessage[];
  lang?: string;
  isReloadRequest?: boolean;
  ignoreClassify?: boolean;
  currentArtifacts?: Array<{ type: string }>;
}): Promise<CommandIntentExtraction> {
  const {
    command,
    lang,
    conversationHistories = [],
    isReloadRequest = false,
    ignoreClassify = false,
    currentArtifacts,
  } = args;
  const llmConfig = await LLMService.getInstance().getLLMConfig({
    overrideModel: command.model,
    generateType: 'object',
  });
  const embeddingModel = LLMService.getInstance().getEmbeddingModel();
  const classifier = getClassifier(embeddingModel, isReloadRequest);
  const clusterName = ignoreClassify ? null : await classifier.doClassify(command.query);

  const additionalSystemPrompts: string[] = command.systemPrompts || [];

  if (clusterName) {
    logger.log(`The user input was classified as "${clusterName}"`);

    const commandTypes = clusterName.split(':');

    if (commandTypes.length === 1) {
      // Create a formatted response based on the classification
      const result: CommandIntentExtraction = {
        commands: [
          {
            commandType: commandTypes[0],
            query: command.query,
          },
        ],
        explanation: `Classified as ${clusterName} command based on semantic similarity.`,
        confidence: 0.9,
        lang,
      };

      return result;
    }
  }

  // Proceed with LLM-based intent extraction
  logger.log('Using LLM for intent extraction');

  try {
    // Create an operation-specific abort signal
    const abortSignal = abortService.createAbortController('intent-extraction');

    const systemPrompts = additionalSystemPrompts.map(content => ({
      role: 'system' as const,
      content,
    }));

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal,
      system: getCommandIntentPrompt({
        commandNames: clusterName ? clusterName.split(':') : null,
        currentArtifacts,
      }),
      messages: [
        ...systemPrompts,
        ...conversationHistories,
        { role: 'user', content: command.query },
      ],
      schema: commandIntentExtractionSchema,
    });

    // Save the embeddings
    if (object.confidence >= 0.9 && object.queryTemplate) {
      try {
        const newClusterName = [...new Set(object.commands.map(cmd => cmd.commandType))].reduce(
          (acc, curVal) => {
            return acc ? `${acc}:${curVal}` : curVal;
          },
          ''
        );
        await classifier.saveEmbedding(object.queryTemplate, newClusterName);
      } catch (error) {
        logger.error('Failed to save query embedding:', error);
      }
    }

    return object;
  } catch (error) {
    logger.error('Error extracting command intent:', error);
    throw error;
  }
}
