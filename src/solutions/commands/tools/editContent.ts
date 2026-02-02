import { MarkdownUtil } from 'src/utils/markdownUtils';
import { z } from 'zod/v3';

export enum EditMode {
  REPLACE_BY_LINES = 'replace_by_lines',
  INSERT = 'insert',
  ADD_TABLE_COLUMN = 'add_table_column',
  UPDATE_TABLE_COLUMN = 'update_table_column',
  DELETE_TABLE_COLUMN = 'delete_table_column',
  REPLACE_BY_PATTERN = 'replace_by_pattern',
}

/**
 * Type for edit tool arguments
 */
export type EditArgs = z.infer<ReturnType<typeof createEditTool>['editSchema']>;

export type EditOperation = EditArgs['operations'][number];

/**
 * Field name mappings for auto-correction
 * Maps common incorrect field names to correct ones
 */
const FIELD_NAME_MAPPINGS: Record<string, string> = {
  // Top-level fields
  editMode: 'mode',
  operationMode: 'mode',
  editType: 'mode',
  type: 'mode',
  filePath: 'path',
  file: 'path',
  file_name: 'path',
  fileName: 'path',
  // Operation-specific fields
  from_line: 'fromLine',
  from_line_number: 'fromLine',
  startLine: 'fromLine',
  start_line: 'fromLine',
  to_line: 'toLine',
  to_line_number: 'toLine',
  endLine: 'toLine',
  end_line: 'toLine',
  line_number: 'line',
  lineNumber: 'line',
  line_num: 'line',
  // Table column fields
  insert_after: 'insertAfter',
  insert_before: 'insertBefore',
  after_column: 'insertAfter',
  before_column: 'insertBefore',
  column_name: 'insertAfter', // Ambiguous, but common mistake
  // Pattern replacement fields
  artifact_id: 'artifactId',
  artifactId: 'artifactId',
  search_pattern: 'searchPattern',
  searchPattern: 'searchPattern',
  pattern: 'searchPattern',
  replace_with: 'replacement',
  replaceWith: 'replacement',
  replace: 'replacement',
};

/**
 * Transform function to fix common field name mistakes
 * @param data The input data (potentially with wrong field names)
 * @returns The data with corrected field names
 */
function fixFieldNames(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => fixFieldNames(item));
  }

  const obj = data as Record<string, unknown>;
  const fixed: Record<string, unknown> = {};

  // First pass: collect all keys and their mappings
  const keyMappings = new Map<string, string>();
  for (const key of Object.keys(obj)) {
    const fixedKey = FIELD_NAME_MAPPINGS[key] || key;
    keyMappings.set(key, fixedKey);
  }

  // Second pass: apply fixes, preferring correct field names
  for (const [key, value] of Object.entries(obj)) {
    const fixedKey = keyMappings.get(key) || key;

    // Skip wrong field names if the correct one already exists
    if (fixedKey !== key && fixedKey in obj && obj[fixedKey] !== undefined) {
      continue;
    }

    // Recursively fix nested objects
    const fixedValue =
      value && typeof value === 'object' && !Array.isArray(value)
        ? fixFieldNames(value)
        : Array.isArray(value)
          ? fixFieldNames(value)
          : value;

    // Use the fixed key, but don't overwrite if it already exists
    if (!(fixedKey in fixed)) {
      fixed[fixedKey] = fixedValue;
    }
  }

  return fixed;
}

export function createEditTool(params: { contentType: 'in_the_note' | 'in_the_chat' }) {
  /**
   * Schema for the edit tool parameters
   */
  const editSchema = z.preprocess(
    fixFieldNames,
    z.object(
      {
        operations: z.array(
          z.discriminatedUnion('mode', [
            z.object(
              {
                mode: z.literal('add_table_column'),
                path: z.string().describe('The path of the EXISTING note to edit.'),
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
                insertAfter: z
                  .string()
                  .optional()
                  .describe(
                    'The name of the column to insert after. If omitted and insertBefore is also omitted, adds at the end.'
                  ),
                insertBefore: z
                  .string()
                  .optional()
                  .describe(
                    'The name of the column to insert before. If omitted and insertAfter is also omitted, adds at the end.'
                  ),
              },
              {
                description:
                  'Add a column to a table, use this to edit a large table (More than 20 rows)',
              }
            ),
            z.object({
              mode: z.literal('update_table_column'),
              path: z.string().describe('The path of the EXISTING note to edit.'),
              content: z
                .string()
                .describe(
                  'The edited column in Markdown format including the header and values (one per line). Example: "Status\\n---\\nPending\\nDone"'
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
                  'The position (0-based) where to edit the column. If omitted, edits the last column.'
                ),
            }),
            z.object({
              mode: z.literal('delete_table_column'),
              path: z.string().describe('The path of the EXISTING note to edit.'),
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
                  'The position (0-based) where to delete the column. If omitted, deletes at the end.'
                ),
            }),
            z.object(
              {
                mode: z.literal('replace_by_lines'),
                path: z.string().describe('The path of the EXISTING note to edit.'),
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
              path: z.string().describe('The path of the EXISTING note to edit.'),
              content: z.string().describe('The content to insert.'),
              line: z.number().describe('The line number (0-based) where to insert the content.'),
            }),
            z.object(
              {
                mode: z.literal('replace_by_pattern'),
                artifactId: z
                  .string()
                  .min(1)
                  .describe('The artifact identifier containing notes to edit.'),
                searchPattern: z
                  .string()
                  .min(1)
                  .describe('The RegExp pattern to search for in the notes.'),
                replacement: z
                  .string()
                  .describe('The content to replace the matched pattern with.'),
              },
              {
                description:
                  'Replace by pattern mode: Replace content matching a pattern across multiple notes from an artifact. Use this when editing multiple files at once.',
              }
            ),
          ])
        ),
        explanation: z
          .string()
          .describe('A brief explanation of what changes are being made and why.'),
      },
      {
        description: `Edit tool used to update existing notes. It won't be able to create a new note automatically.`,
      }
    )
  );

  function execute(args: EditArgs): EditOperation[] {
    args = repairEditToolCallArgs(args);

    return args.operations;
  }

  return {
    editSchema,
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
    // Unescape replacement if present
    if ('replacement' in operation) {
      operation.replacement = new MarkdownUtil(operation.replacement).unescape().getText();
    }
  }

  return repairedArgs;
}
