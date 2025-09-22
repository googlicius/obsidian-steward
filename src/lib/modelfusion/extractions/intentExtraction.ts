import { logger } from 'src/utils/logger';
import { ConversationHistoryMessage, CommandIntent } from 'src/types/types';
import { CommandTypeExtraction, extractCommandTypes } from './commandTypeExtraction';
import { extractQueries, QueryExtraction } from './queryExtraction';
import { getClassifier } from '../classifiers/getClassifier';
import { LLMService } from 'src/services/LLMService';

export type CommandIntentExtraction = Omit<CommandTypeExtraction, 'commandTypes'> & QueryExtraction;

/**
 * Extract command intents from a general query using AI with a 2-step approach
 * Step 1: Extract command types
 * Step 2: Extract specific queries for each command type
 * @returns Extracted command types, content, and explanation
 */
export async function extractCommandIntent(args: {
  command: CommandIntent;
  conversationHistories: ConversationHistoryMessage[];
  lang?: string | null;
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

    // If command type is not read or generate, return early
    if (commandTypeExtraction.commandTypes.length === 1) {
      const commandType = commandTypeExtraction.commandTypes[0];

      if (commandType !== 'read' && commandType !== 'generate') {
        return {
          commands: [{ commandType, query: command.query }],
          explanation: commandTypeExtraction.explanation,
          confidence: commandTypeExtraction.confidence,
          lang,
        };
      }
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
