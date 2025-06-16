import { generateText, classify, OpenAIChatMessage } from 'modelfusion';
import { createLLMGenerator } from '../llmConfig';
import { commandIntentPrompt } from '../prompts/commandIntentPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
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
// import { extractImageLinks, extractWikilinks } from 'src/utils/noteContentUtils';
import { App } from 'obsidian';

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
 * @param llmConfig LLM configuration settings
 * @param app Obsidian app instance for accessing vault files
 * @returns Extracted command types, content, and explanation
 */
export async function extractCommandIntent(
  userInput: string,
  llmConfig: StewardPluginSettings['llm'],
  app: App
): Promise<CommandIntentExtraction> {
  // const imageLinks = extractImageLinks(userInput);
  // const wikilinks = extractWikilinks(userInput);

  // If the user input contains images, or wikilinks, classify it as a generate command
  // if (imageLinks.length > 0 || wikilinks.length > 0) {
  //   return {
  //     commands: [
  //       {
  //         commandType: 'generate',
  //         content: userInput,
  //       },
  //     ],
  //     explanation: `Classified as "generate" command based on the presence of images or wikilinks.`,
  //     confidence: 1,
  //   };
  // }

  const clusterName = await classify({
    model: getClassifier(llmConfig.model, llmConfig.corsProxyUrl),
    value: userInput,
  });

  const additionalPrompts: OpenAIChatMessage[] = [];

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
      additionalPrompts.push(interpretSearchContentPrompt);
    }

    if (clusterNames.length > 1) {
      if (clusterNames.includes('delete_from_artifact')) {
        additionalPrompts.push(interpretDeleteFromArtifactPrompt);
      }

      if (
        clusterNames.includes('copy_from_artifact') ||
        clusterNames.includes('move_from_artifact')
      ) {
        additionalPrompts.push(interpretDestinationFolderPrompt);
      }

      if (clusterNames.includes('update_from_artifact')) {
        additionalPrompts.push(interpretUpdateFromArtifactPrompt);
      }

      if (clusterNames.includes('read')) {
        additionalPrompts.push(interpretReadContentPrompt);
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
        confidence: 0.8,
        lang: 'en',
      };

      return result;
    }
  }

  // Proceed with LLM-based intent extraction
  logger.log('Using LLM for intent extraction');

  // Create an operation-specific abort signal
  const abortSignal = abortService.createAbortController('intent-extraction');

  const response = await generateText({
    model: createLLMGenerator(llmConfig),
    run: { abortSignal },
    prompt: [
      userLanguagePrompt,
      commandIntentPrompt,
      ...additionalPrompts,
      { role: 'user', content: userInput },
    ],
  });

  // Parse and validate the JSON response
  const parsed = JSON.parse(response);
  const validatedResult = validateCommandIntentExtraction(parsed);

  // Save the embeddings
  if (validatedResult.confidence >= 0.9 && validatedResult.queryTemplate) {
    try {
      const newClusterName = [
        ...new Set(validatedResult.commands.map(cmd => cmd.commandType)),
      ].reduce((acc, curVal) => {
        return acc ? `${acc}:${curVal}` : curVal;
      }, '');
      await intentClassifier.saveEmbedding(validatedResult.queryTemplate, newClusterName);
    } catch (error) {
      logger.error('Failed to save query embedding:', error);
    }
  }

  return validatedResult;
}

/**
 * Validate that the command intent extraction contains all required fields
 */
function validateCommandIntentExtraction(data: any): CommandIntentExtraction {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response format');
  }

  if (!Array.isArray(data.commands) || data.commands.length === 0) {
    logger.warn('Commands is an empty array');
  }

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
  ];

  // Check if there are too many commands
  if (data.commands.length > 20) {
    throw new Error(`Too many commands: ${data.commands.length}. Maximum allowed is 20.`);
  }

  // Validate each command in the sequence
  const validatedCommands = data.commands.map((cmd: any, index: number) => {
    if (!cmd || typeof cmd !== 'object') {
      throw new Error(`Invalid command format at index ${index}`);
    }

    if (!validCommandTypes.includes(cmd.commandType)) {
      throw new Error(
        `Command type at index ${index} (${cmd.commandType}) must be one of: ${validCommandTypes.join(', ')}`
      );
    }

    if (typeof cmd.content !== 'string' || !cmd.content.trim()) {
      logger.warn(`Content is empty at index ${index}`);
    }

    return {
      commandType: cmd.commandType,
      content: cmd.content.trim(),
    };
  });

  if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
    throw new Error('Explanation must be a non-empty string');
  }

  if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
    throw new Error('Confidence must be a number between 0 and 1');
  }

  // Lang is optional, but if provided, must be a valid string
  const lang =
    data.lang && typeof data.lang === 'string' && data.lang.trim() ? data.lang.trim() : 'en';

  // QueryTemplate is optional, but if provided, must be a valid string
  const queryTemplate =
    data.queryTemplate && typeof data.queryTemplate === 'string' && data.queryTemplate.trim()
      ? data.queryTemplate.trim()
      : undefined;

  return {
    commands: validatedCommands,
    explanation: data.explanation.trim(),
    confidence: data.confidence,
    lang,
    queryTemplate,
  };
}
