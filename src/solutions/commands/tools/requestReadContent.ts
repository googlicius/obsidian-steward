import { tool } from 'ai';
import { z } from 'zod';
import { COMMAND_DEFINITIONS } from 'src/lib/modelfusion/prompts/commands';

const readCommandQueryTemplate = COMMAND_DEFINITIONS.find(
  command => command.commandType === 'read'
)?.queryTemplate;

/**
 * Schema for the requestReadContent tool parameters
 */
const requestReadContentSchema = z.object({
  query: z.string().describe(`The query to read content from notes.

QUERY TEMPLATE:
${readCommandQueryTemplate}`),
  explanation: z.string().describe(`A brief explanation of why reading this content is necessary.`),
});

/**
 * Type for requestReadContent tool arguments
 */
export type RequestReadContentArgs = z.infer<typeof requestReadContentSchema>;

/**
 * Tool name constant for requestReadContent
 */
export const REQUEST_READ_CONTENT_TOOL_NAME = 'requestReadContent';

/**
 * Shared requestReadContent tool definition
 */
export const requestReadContentTool = tool({
  parameters: requestReadContentSchema,
});
