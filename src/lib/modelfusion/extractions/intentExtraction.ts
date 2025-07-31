import { generateObject } from 'ai';
import { classify } from 'modelfusion';
import { commandIntentPrompt } from '../prompts/commandIntentPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';
import {
  interpretDeleteFromArtifactPrompt,
  interpretDestinationFolderPrompt,
  interpretSearchContentPrompt,
  interpretUpdateFromArtifactPrompt,
  interpretReadContentPrompt,
} from '../prompts/interpretQueryPrompts';
import { getClassifier } from '../classifiers/getClassifier';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { ConversationHistoryMessage } from 'src/types/types';
import { explanationFragment } from '../prompts/fragments';
import { getValidCommandTypes } from '../prompts/commands';

// Use AbortService instead of a local controller
const abortService = AbortService.getInstance();

/**
 * Represents a single command in a sequence
 */
export interface CommandIntent {
  commandType: string;
  query: string;
  systemPrompts?: string[];
  model?: string; // Optional model to use for this command
}

// Define valid command types
const validCommandTypes = getValidCommandTypes();

// Define the Zod schema for command intent
const commandIntentSchema = z.object({
  commandType: z
    .enum(validCommandTypes as [string, ...string[]])
    .describe(`One of the available command types.`),
  query: z.string().describe(
    `The specific query for this command. The query is used to extract further into parameters for actual function calls in local. So make it clear and concise.
If the command is "read" or "create", then this is the original user's query.`
  ),
});

// Define the Zod schema for command intent extraction
const commandIntentExtractionSchema = z.object({
  commands: z.array(commandIntentSchema).max(20, 'Too many commands. Maximum allowed is 20.')
    .describe(`An array of objects, each containing commandType and query.
Analyze the query for multiple commands that should be executed in sequence.
Each command in the sequence should have its own query that will be processed by specialized handlers.
If the user wants to:
- Search for notes (and doesn't mention existing search results), include "search"
- Move notes from the artifact, include "move_from_artifact"
- Delete notes from the artifact, include "delete_from_artifact"
- Copy notes from the artifact, include "copy_from_artifact"
- Update notes from the artifact, include "update_from_artifact"
- Close the conversation, include "close"
- Undo changes, include "revert"
- Generate an image, include "image"
- Generate audio, include "audio"
- Create a new note, include "create"
- Generate content with the LLM help in a sub-prompt (either in a new note or the conversation), include "generate"
- Read or Find content based on a specific pattern in their current note, include "read"
- Ask something about the content of the current note, include "read" and "generate"
- Update something about the content of the current note, include "read", "generate" and "update_from_artifact"
- Show the list of available commands, include "help"
Important Notes:
- If the "read" and "generate" are included, you must extract all the elements mentioned in the user's query in the "query" field of the "read" command
- If there is previous messages in the conversation, include "generate" command only`),
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

function extractReadGenerate(userInput: string): CommandIntentExtraction {
  return {
    commands: [
      {
        commandType: 'read',
        query: userInput,
      },
      {
        commandType: 'generate',
        query: userInput,
      },
    ],
    explanation: `Classified as "read:generate" command based on semantic similarity.`,
    confidence: 0.8,
  };
}

function extractReadGenerateUpdateFromArtifact(userInput: string): CommandIntentExtraction {
  return {
    commands: [
      {
        commandType: 'read',
        query: userInput,
      },
      {
        commandType: 'generate',
        query: userInput,
      },
      {
        commandType: 'update_from_artifact',
        query: '',
      },
    ],
    explanation: `Classified as "read:generate:update_from_artifact" command based on semantic similarity.`,
    confidence: 0.8,
  };
}

/**
 * Extract command intents from a general query using AI
 * @param command Command intent
 * @param lang Language of the user
 * @param conversationHistory Conversation history for context
 * @param isReloadRequest Flag indicating if this is a reload request
 * @returns Extracted command types, content, and explanation
 */
export async function extractCommandIntent(
  command: CommandIntent,
  lang: string | undefined,
  conversationHistory: ConversationHistoryMessage[] = [],
  isReloadRequest = false
): Promise<CommandIntentExtraction> {
  const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);
  const classifier = getClassifier(llmConfig.model.modelId, isReloadRequest);
  const clusterName = await classify({
    model: classifier,
    value: command.query,
  });

  const additionalSystemPrompts: string[] = [];

  if (clusterName) {
    logger.log(`The user input was classified as "${clusterName}"`);

    if (clusterName === 'read:generate') {
      return {
        ...extractReadGenerate(command.query),
        lang,
      };
    }

    if (clusterName === 'read:generate:update_from_artifact') {
      return {
        ...extractReadGenerateUpdateFromArtifact(command.query),
        lang,
      };
    }

    const clusterNames = clusterName.split(':');

    // Add some additional prompts to extract multiple intents
    if (clusterNames.includes('search')) {
      additionalSystemPrompts.push(interpretSearchContentPrompt.content as string);
    }

    if (clusterNames.length > 1) {
      if (clusterNames.includes('delete_from_artifact')) {
        additionalSystemPrompts.push(interpretDeleteFromArtifactPrompt.content as string);
      }

      if (
        clusterNames.includes('copy_from_artifact') ||
        clusterNames.includes('move_from_artifact')
      ) {
        additionalSystemPrompts.push(interpretDestinationFolderPrompt.content as string);
      }

      if (clusterNames.includes('update_from_artifact')) {
        additionalSystemPrompts.push(interpretUpdateFromArtifactPrompt.content as string);
      }

      if (clusterNames.includes('read')) {
        additionalSystemPrompts.push(interpretReadContentPrompt.content as string);
      }
    } else {
      // Create a formatted response based on the classification
      const result: CommandIntentExtraction = {
        commands: [
          {
            commandType: clusterName,
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

    if (conversationHistory.length > 1) {
      systemPrompts.push({
        role: 'system',
        content:
          'There are previous messages in this conversation. Use this context for better intent extraction.',
      });
    }

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal,
      system: commandIntentPrompt,
      messages: [...systemPrompts, { role: 'user', content: command.query }],
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
