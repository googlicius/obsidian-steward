import { tool } from 'ai';
import { z } from 'zod';

/**
 * Schema for the edit tool parameters
 */
const editSchema = z.object({
  fromLine: z
    .number()
    .describe(
      "The starting line number (0-based) of the content to be replaced. Get this from the read_result artifact or grep tool's result."
    ),
  toLine: z
    .number()
    .describe(
      "The ending line number (0-based) of the content to be replaced. Get this from the read_result artifact or grep tool's result."
    ),
  newContent: z.string().describe('The new content to replace the old content with.'),
  filePath: z
    .string()
    .optional()
    .describe('The path of the file to edit. If not provided, edits the current note.'),
  explanation: z.string().describe('A brief explanation of what changes are being made and why.'),
  editMode: z
    .enum(['replace', 'above', 'below'])
    .optional()
    .describe(
      'How to apply the content: "replace" (default) to replace the content between fromLine and toLine, "above" to insert before fromLine, "below" to insert after toLine.'
    ),
});

/**
 * Type for edit tool arguments
 */
export type EditArgs = z.infer<typeof editSchema>;

/**
 * Tool name constant for edit
 */
export const EDIT_TOOL_NAME = 'edit';

/**
 * Shared edit tool definition
 */
export const editTool = tool({
  parameters: editSchema,
});
