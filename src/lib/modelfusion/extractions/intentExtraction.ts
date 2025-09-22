import { logger } from 'src/utils/logger';
import { ConversationHistoryMessage, CommandIntent } from 'src/types/types';
import { z } from 'zod';
import { CommandTypeExtraction, extractCommandTypes } from './commandTypeExtraction';
import { extractQueries } from './queryExtraction';
import { getClassifier } from '../classifiers/getClassifier';
import { LLMService } from 'src/services/LLMService';

// Define the Zod schema for command intent
const commandIntentSchema = z.object({
  commandType: z.string().describe(`One of the available command types.`),
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
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1)
    .describe(`A confidence score from 0 to 1 for the overall sequence:
- 0.0-0.3: Low confidence (ambiguous or unclear requests)
- 0.4-0.7: Medium confidence (likely, but could be interpreted differently)
- 0.8-1.0: High confidence (very clear intent)
If the confidence is low, include the commands that you are extracting in the explanation so the user decides whether to proceed or not.`),
  lang: z.string().optional(),
  queryTemplate: z
    .string()
    .optional()
    .describe(
      `A template version of the query where specific elements (tags, keywords, filenames, folders) are replaced with generic placeholders (x, y, z, f). This helps identify similar query patterns for caching purposes.`
    ),
  shortDescription: z.string().optional().describe(`A short description of the command intent.`),
});

export type CommandIntentExtraction = z.infer<typeof commandIntentExtractionSchema>;

/**
 * Extract command intents from a general query using AI with a 2-step approach
 * Step 1: Extract command types
 * Step 2: Extract specific queries for each command type
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
    ignoreClassify = true,
    currentArtifacts,
  } = args;

  try {
    logger.log('Starting 2-step intent extraction process');

    // Get classifier for semantic similarity check
    let commandTypeExtraction: CommandTypeExtraction | undefined;

    if (!ignoreClassify) {
      const embeddingModel = LLMService.getInstance().getEmbeddingModel();
      const classifier = getClassifier(embeddingModel, isReloadRequest);
      const clusterName = await classifier.doClassify(command.query);

      if (clusterName) {
        logger.log(`The user input was classified as "${clusterName}"`);
        const classifiedCommandTypes = clusterName.split(':');

        // If classified, create command type extraction result directly without calling the function
        commandTypeExtraction = {
          commandTypes: classifiedCommandTypes,
          explanation: `Classified as ${clusterName} command based on semantic similarity.`,
          confidence: 0.9,
        };
      }
    }

    // Step 1: Extract command types (only if not already classified)
    if (!commandTypeExtraction) {
      commandTypeExtraction = await extractCommandTypes({
        command,
        conversationHistories,
        currentArtifacts,
      });
    }

    // If no command types were extracted or confidence is very low, return early
    if (commandTypeExtraction.commandTypes.length === 0) {
      return {
        commands: [],
        explanation: commandTypeExtraction.explanation,
        confidence: commandTypeExtraction.confidence,
        lang,
      };
    }

    // Step 2: Extract specific queries for each command type
    logger.log(`Extracting queries for ${commandTypeExtraction.commandTypes.length} command(s)`);

    const queryExtraction = await extractQueries({
      command,
      commandTypes: commandTypeExtraction.commandTypes,
      conversationHistories,
      currentArtifacts,
    });

    // Combine the results from both steps
    const result: CommandIntentExtraction = {
      commands: queryExtraction.commands,
      explanation: queryExtraction.explanation,
      confidence: commandTypeExtraction.confidence,
      queryTemplate: commandTypeExtraction.queryTemplate,
      lang,
    };

    // Save the embeddings after both steps are complete
    if (result.confidence >= 0.9 && result.queryTemplate && !ignoreClassify) {
      try {
        const embeddingModel = LLMService.getInstance().getEmbeddingModel();
        const classifier = getClassifier(embeddingModel, isReloadRequest);

        // Create cluster name from unique command types
        const newClusterName = [...new Set(result.commands.map(cmd => cmd.commandType))].reduce(
          (acc, curVal) => {
            return acc ? `${acc}:${curVal}` : curVal;
          },
          ''
        );

        await classifier.saveEmbedding(result.queryTemplate, newClusterName);
        logger.log(`Saved embedding for query template with cluster: ${newClusterName}`);
      } catch (error) {
        logger.error('Failed to save query embedding:', error);
      }
    }

    return result;
  } catch (error) {
    logger.error('Error in 2-step intent extraction:', error);
    throw error;
  }
}

// Re-export the types from the sub-modules for backwards compatibility
export type { CommandTypeExtraction } from './commandTypeExtraction';
export type { QueryExtraction } from './queryExtraction';
