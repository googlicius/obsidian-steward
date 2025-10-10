import { tool } from 'ai';
import { z } from 'zod';

// LLMs understand of using confirmation tool could be varies:
// - As very straightforward understanding: If you need to read a note entirely, you need to ask for confirmation.
// - But another argued that if the user directly ask for read entire a note, so it says no need to get confirmation from the user.

/**
 * Type for askUser tool arguments
 */
export type AskUserArgs = z.infer<ReturnType<typeof createAskUserSchema>>;

/**
 * Tool name constants
 */
export const CONFIRMATION_TOOL_NAME = 'confirmation';
export const ASK_USER_TOOL_NAME = 'askUser';

/**
 * Creates a schema for the askUser tool based on the mode
 */
function createAskUserSchema(mode: 'confirmation' | 'ask') {
  const messageDescription =
    mode === 'confirmation'
      ? `The message that you ask to get confirmation from the user.
- Use first-person perspective, e.g, I need, I will, etc.`
      : `The message to ask the user for additional information or clarification.
- Use first-person perspective, e.g, I need, I will, etc.
- Be specific about what information you need from the user.`;

  return z.object({
    message: z.string().describe(messageDescription),
  });
}

/**
 * Creates an askUser tool based on the mode
 * @param mode - 'confirmation' for requesting user confirmation, 'ask' for requesting additional information
 */
export function createAskUserTool(mode: 'confirmation' | 'ask') {
  return tool({
    parameters: createAskUserSchema(mode),
  });
}
