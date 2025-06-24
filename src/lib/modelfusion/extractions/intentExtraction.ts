import { generateObject } from 'ai';
import { classify } from 'modelfusion';
import { commandIntentPrompt } from '../prompts/commandIntentPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { intentClassifier } from '../classifiers/intent';
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
import { StewardPluginSettings } from 'src/types/interfaces';

// Use AbortService instead of a local controller
const abortService = AbortService.getInstance();

/**
 * Represents a single command in a sequence
 */
export interface CommandIntent {
  commandType: string;
  content: string;
  systemPrompts?: string[];
}

/**
 * Represents the extracted command intents from a general query
 */
export interface CommandIntentExtraction {
  commands: CommandIntent[];
  explanation: string;
  confidence: number;
  lang?: string;
  queryTemplate?: string;
}

// Define valid command types
const validCommandTypes = [
  'search',
  'move',
  'copy',
  'move_from_artifact',
  'delete_from_artifact',
  'close',
  'confirm',
  'revert',
  'image',
  'audio',
  'update_from_artifact',
  'create',
  'generate',
  'read',
  'stop',
] as const;

// Define the Zod schema for command intent
const commandIntentSchema = z.object({
  commandType: z.enum(validCommandTypes),
  content: z.string(),
  systemPrompts: z.array(z.string()).optional(),
});

// Define the Zod schema for command intent extraction
const commandIntentExtractionSchema = z.object({
  commands: z.array(commandIntentSchema).max(20, 'Too many commands. Maximum allowed is 20.'),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1),
  lang: z.string().optional().default('en'),
  queryTemplate: z.string().optional(),
});

function extractReadGenerate(userInput: string): CommandIntentExtraction {
  return {
    commands: [
      {
        commandType: 'read',
        content: userInput,
      },
      {
        commandType: 'generate',
        content: userInput,
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
        content: userInput,
      },
      {
        commandType: 'generate',
        content: userInput,
      },
      {
        commandType: 'update_from_artifact',
        content: '',
      },
    ],
    explanation: `Classified as "read:generate:update_from_artifact" command based on semantic similarity.`,
    confidence: 0.8,
  };
}

/**
 * Extract command intents from a general query using AI
 * @param userInput Natural language request from the user
 * @param app Obsidian app instance for accessing vault files
 * @returns Extracted command types, content, and explanation
 */
export async function extractCommandIntent(
  userInput: string,
  llmConfig: StewardPluginSettings['llm']
): Promise<CommandIntentExtraction> {
  const clusterName = await classify({
    model: getClassifier(llmConfig?.model || 'gpt-4', llmConfig?.corsProxyUrl),
    value: userInput,
  });

  const additionalSystemPrompts: string[] = [];

  if (clusterName) {
    logger.log(`The user input was classified as "${clusterName}"`);

    if ((clusterName as string) === 'read:generate') {
      return extractReadGenerate(userInput);
    }

    if ((clusterName as string) === 'read:generate:update_from_artifact') {
      return extractReadGenerateUpdateFromArtifact(userInput);
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
            content: userInput,
          },
        ],
        explanation: `Classified as ${clusterName} command based on semantic similarity.`,
        confidence: 0.9,
        lang: 'en',
      };

      return result;
    }
  }

  // Proceed with LLM-based intent extraction
  logger.log('Using LLM for intent extraction');

  try {
    // Create an operation-specific abort signal
    const abortSignal = abortService.createAbortController('intent-extraction');

    const llm = await LLMService.getInstance().getLLMConfig();

    const { object } = await generateObject({
      ...llm,
      abortSignal,
      system: `${commandIntentPrompt.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content: userInput },
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
        await intentClassifier.saveEmbedding(object.queryTemplate, newClusterName);
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
