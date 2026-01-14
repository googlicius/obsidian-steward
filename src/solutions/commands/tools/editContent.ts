import { tool } from 'ai';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { z } from 'zod/v3';

export enum EditMode {
  REPLACE = 'replace',
  INSERT = 'insert',
  ADD_TABLE_COLUMN = 'add_table_column',
  UPDATE_TABLE_COLUMN = 'update_table_column',
  DELETE_TABLE_COLUMN = 'delete_table_column',
}

/**
 * Type for edit tool arguments
 */
export type EditArgs = z.infer<ReturnType<typeof createEditTool>['editSchema']>;

export type EditOperation = EditArgs['operations'][number];

export function createEditTool(params: { contentType: 'in_the_note' | 'in_the_chat' }) {
  /**
   * Schema for the edit tool parameters
   */
  const editSchema = z.object(
    {
      operations: z.array(
        z.discriminatedUnion('mode', [
          z.object(
            {
              mode: z.literal('add_table_column'),
              content: z
                .string()
                .describe(
                  'The new column in Markdown format including the header and values (one per line). Example: "Status\\n---\\nPending\\nDone"'
                ),
              fromLine: z
                .number()
                .describe('The starting line number (0-based) of the table to modify.'),
              toLine: z
                .number()
                .describe('The ending line number (0-based) of the table to modify.'),
              position: z
                .number()
                .optional()
                .describe(
                  'The position (0-based) where to insert the column. If omitted, adds at the end.'
                ),
            },
            {
              description:
                'Add a column to a table, use this to edit a large table (More than 20 rows)',
            }
          ),
          z.object({
            mode: z.literal('update_table_column'),
            content: z
              .string()
              .describe(
                'The edited column in Markdown format including the header and values (one per line). Example: "Status\\n---\\nPending\\nDone"'
              ),
            fromLine: z
              .number()
              .describe('The starting line number (0-based) of the table to modify.'),
            toLine: z.number().describe('The ending line number (0-based) of the table to modify.'),
            position: z
              .number()
              .optional()
              .describe(
                'The position (0-based) where to edit the column. If omitted, edits the last column.'
              ),
          }),
          z.object({
            mode: z.literal('delete_table_column'),
            fromLine: z
              .number()
              .describe('The starting line number (0-based) of the table to modify.'),
            toLine: z.number().describe('The ending line number (0-based) of the table to modify.'),
            position: z
              .number()
              .optional()
              .describe(
                'The position (0-based) where to delete the column. If omitted, deletes at the end.'
              ),
          }),
          z.object(
            {
              mode: z.literal('replace'),
              content: z.string().describe(
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
                .optional()
                .describe(
                  'The starting line number (0-based) of the original content. Must be provided together with toLine, or both must be omitted to replace the entire file.'
                ),
              toLine: z
                .number()
                .optional()
                .describe(
                  'The ending line number (0-based) of the original content. Must be provided together with fromLine, or both must be omitted to replace the entire file.'
                ),
            },
            {
              description:
                'Replace mode: Replace content within a specific line range, or replace the entire file if both fromLine and toLine are omitted.',
            }
          ),
          z.object({
            mode: z.literal('insert'),
            content: z.string().describe('The content to insert.'),
            line: z.number().describe('The line number (0-based) where to insert the content.'),
          }),
        ])
      ),
      filePath: z
        .string()
        .optional()
        .describe(
          'The path of the EXISTING note to edit. If not provided, edits the current note.'
        ),
      explanation: z
        .string()
        .describe('A brief explanation of what changes are being made and why.'),
    },
    {
      description: `Edit tool used to update an existing note. It won't be able to create a new note automatically.`,
    }
  );

  const editTool = tool({
    inputSchema: editSchema,
  });

  function execute(args: EditArgs): EditOperation[] {
    args = repairEditToolCallArgs(args);

    return args.operations;
  }

  return {
    editSchema,
    editTool,
    execute,
  };
}

function repairEditToolCallArgs(args: EditArgs): EditArgs {
  const repairedArgs = { ...args };

  // Unescape the content
  for (const operation of repairedArgs.operations) {
    if ('content' in operation) {
      operation.content = new MarkdownUtil(operation.content).unescape().getText();
    }
  }

  return repairedArgs;
}
