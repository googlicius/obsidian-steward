import { tool } from 'ai';
import { z } from 'zod';

/**
 * Schema for the edit tool parameters
 */
const editSchema = z.object({
  oldContent: z
    .string()
    .describe('The exact content to be replaced. Must match the current content in the note.'),
  newContent: z.string().describe('The new content to replace the old content with.'),
  filePath: z
    .string()
    .optional()
    .describe('The path of the file to edit. If not provided, edits the current note.'),
  explanation: z.string().describe('A brief explanation of what changes are being made and why.'),
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
