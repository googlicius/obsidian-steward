import { generateObject } from 'ai';
import { getCommandTypePrompt } from '../prompts/commandTypePrompt';
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

// Define the Zod schema for command type extraction
const commandTypeExtractionSchema = z.object({
  commandTypes: z
    .array(z.enum(validCommandTypes as [string, ...string[]]))
    .max(20, 'Too many commands. Maximum allowed is 20.')
    .describe('An array of command types that should be executed in sequence.'),
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
  queryTemplate: z
    .string()
    .optional()
    .describe(
      `A template version of the query where specific elements (tags, keywords, filenames, folders) are replaced with generic placeholders (x, y, z, f). This helps identify similar query patterns for caching purposes.`
    ),
});

export type CommandTypeExtraction = z.infer<typeof commandTypeExtractionSchema>;

/**
 * Extract command types from a general query using AI (Step 1)
 * @returns Extracted command types and explanation
 */
export async function extractCommandTypes(args: {
  command: CommandIntent;
  conversationHistories: ConversationHistoryMessage[];
  currentArtifacts?: Array<{ type: string }>;
}): Promise<CommandTypeExtraction> {
  const { command, conversationHistories = [], currentArtifacts } = args;

  const llmConfig = await LLMService.getInstance().getLLMConfig({
    overrideModel: command.model,
    generateType: 'object',
  });

  const additionalSystemPrompts: string[] = command.systemPrompts || [];

  // Proceed with LLM-based command type extraction
  logger.log('Using LLM for command type extraction');

  try {
    // Create an operation-specific abort signal
    const abortSignal = abortService.createAbortController('command-type-extraction');

    const systemPrompts = additionalSystemPrompts.map(content => ({
      role: 'system' as const,
      content,
    }));

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal,
      system: getCommandTypePrompt({
        currentArtifacts,
      }),
      messages: [
        ...systemPrompts,
        ...conversationHistories,
        { role: 'user', content: command.query },
      ],
      schema: commandTypeExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting command types:', error);
    throw error;
  }
}
