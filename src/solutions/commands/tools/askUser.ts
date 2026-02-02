import { z } from 'zod/v3';
import { getCdnLib } from 'src/utils/cdnUrls';

// LLMs understand of using confirmation tool could be varies:
// - As very straightforward understanding: If you need to read a note entirely, you need to ask for confirmation.
// - But another argued that if the user directly ask for read entire a note, so it says no need to get confirmation from the user.

/**
 * Creates an askUser tool based on the mode
 * @param mode - 'confirmation' for requesting user confirmation, 'ask' for requesting additional information
 */
export async function createAskUserTool(mode: 'confirmation' | 'ask') {
  const messageDescription =
    mode === 'confirmation'
      ? `The message that you ask to get confirmation from the user.
- Use first-person perspective, e.g, I need, I will, etc.`
      : `The message to ask the user for additional information or clarification.
- Use first-person perspective, e.g, I need, I will, etc.
- Be specific about what information you need from the user.`;

  const askUserSchema = z.object({
    message: z.string().describe(messageDescription),
  });

  const { tool } = await getCdnLib('ai');
  const askUserTool = tool({
    inputSchema: askUserSchema,
  });

  return {
    askUserSchema,
    askUserTool,
  };
}

/**
 * Type for askUser tool arguments
 */
export type AskUserArgs = z.infer<Awaited<ReturnType<typeof createAskUserTool>>['askUserSchema']>;
