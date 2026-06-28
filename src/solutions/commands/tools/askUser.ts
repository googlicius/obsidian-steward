import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';

/**
 * Creates the confirmation tool schema (request user approval before an action).
 */
export async function createConfirmationTool() {
  const confirmationSchema = z.object({
    message: z.string().describe(
      `The message that you ask to get confirmation from the user.
- Use first-person perspective, e.g, I need, I will, etc.`
    ),
  });

  const { tool } = await getBundledLib('ai');
  const confirmationTool = tool({
    inputSchema: confirmationSchema,
  });

  return {
    confirmationSchema,
    confirmationTool,
  };
}

export type ConfirmationArgs = z.infer<
  Awaited<ReturnType<typeof createConfirmationTool>>['confirmationSchema']
>;
