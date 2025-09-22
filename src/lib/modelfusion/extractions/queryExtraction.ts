import { generateObject } from 'ai';
import { getQueryExtractionPrompt } from '../prompts/queryExtractionPrompt';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';
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

// Define the Zod schema for query extraction
const queryExtractionSchema = z.object({
  commands: z.array(commandIntentSchema).max(20, 'Too many commands. Maximum allowed is 20.')
    .describe(`An array of objects, each containing commandType and query.
Each command in the sequence should have its own query that will be processed by specialized handlers.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
});

export type QueryExtraction = z.infer<typeof queryExtractionSchema>;

/**
 * Extract specific queries for each command type using AI (Step 2)
 * @returns Extracted commands with queries
 */
export async function extractQueries(args: {
  command: CommandIntent;
  commandTypes: string[];
  conversationHistories: ConversationHistoryMessage[];
  currentArtifacts?: Array<{ type: string }>;
}): Promise<QueryExtraction> {
  const { command, commandTypes, conversationHistories = [], currentArtifacts } = args;

  const llmConfig = await LLMService.getInstance().getLLMConfig({
    overrideModel: command.model,
    generateType: 'object',
  });

  const additionalSystemPrompts: string[] = command.systemPrompts || [];

  // Proceed with LLM-based query extraction
  logger.log('Using LLM for query extraction');

  try {
    // Create an operation-specific abort signal
    const abortSignal = abortService.createAbortController('query-extraction');

    const systemPrompts = additionalSystemPrompts.map(content => ({
      role: 'system' as const,
      content,
    }));

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal,
      system: getQueryExtractionPrompt({
        commandTypes,
        currentArtifacts,
      }),
      messages: [
        ...systemPrompts,
        ...conversationHistories,
        { role: 'user', content: command.query },
      ],
      schema: queryExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting queries:', error);
    throw error;
  }
}
