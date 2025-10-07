import { tool } from 'ai';
import { UpdateInstruction } from 'src/lib/modelfusion';
import { ArtifactType } from 'src/solutions/artifact';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { z } from 'zod';

/**
 * Tool name constant for edit
 */
export const EDIT_TOOL_NAME = 'edit';

/**
 * Type for edit tool arguments
 */
export type EditArgs = z.infer<ReturnType<typeof createEditTool>['editSchema']>;

export function createEditTool(params: { contentType: 'in_the_note' | 'in_the_chat' }) {
  /**
   * Schema for the edit tool parameters
   */
  const editSchema = z.object({
    operations: z.array(
      z.object(
        {
          newContent: z.string().describe(
            params.contentType === 'in_the_chat'
              ? 'The new content to replace the old content with.'
              : `Only the specific part of the content that needs to be updated, without any surrounding context.
Examples:
- For table updates: Return only the updated rows, not the entire table
- For text edits: Return only the changed sentences/paragraphs, not surrounding content
- For list updates: Return only the added/modified list items, not the entire list.`
          ),
          fromLine: z
            .number()
            .describe('The starting line number (0-based) of the original content.'),
          toLine: z.number().describe('The ending line number (0-based) of the original content.'),
          mode: z
            .enum(['replace', 'above', 'below'])
            .default('replace')
            .describe(
              'How to apply the content: "replace" (default) to replace the content between fromLine and toLine, "above" to insert before fromLine, "below" to insert after toLine.'
            ),
        },
        {
          description: `The fromLine and toLine are provided from the ${ArtifactType.READ_CONTENT} artifact or grep's result.
NOTE:
- If editing is in 1 line, the fromLine and toLine MUST be the same.`,
        }
      )
    ),
    filePath: z
      .string()
      .optional()
      .describe('The path of the file to edit. If not provided, edits the current note.'),
    explanation: z.string().describe('A brief explanation of what changes are being made and why.'),
  });

  const editTool = tool({
    parameters: editSchema,
  });

  function execute(args: EditArgs): UpdateInstruction[] {
    args = repairEditToolCallArgs(args);

    return args.operations.map(operation => {
      const editMode = operation.mode || 'replace';
      if (editMode === 'replace') {
        // Replace operation (existing logic)
        return {
          type: 'replace' as const,
          fromLine: operation.fromLine,
          toLine: operation.toLine,
          new: operation.newContent,
        };
      } else if (editMode === 'above') {
        // Insert above the grepped content (before fromLine)
        return {
          type: 'add' as const,
          content: operation.newContent,
          position: operation.fromLine,
        };
      } else {
        // Insert below the grepped content (after toLine)
        return {
          type: 'add' as const,
          content: operation.newContent,
          position: operation.toLine + 1,
        };
      }
    });
  }

  return {
    editSchema,
    editTool,
    execute,
  };
}

function repairEditToolCallArgs(args: EditArgs): EditArgs {
  const repairedArgs = { ...args };

  // Unescape the newContent
  repairedArgs.operations.forEach(operation => {
    operation.newContent = new MarkdownUtil(operation.newContent).unescape().getText();
  });

  return repairedArgs;
}
