import { tool } from 'ai';
import { z } from 'zod';

export type CreateToolArgs = z.infer<ReturnType<typeof createCreateTool>['createSchema']>;

export type CreateNoteInstruction = {
  filePath: string;
  content?: string;
};

export type CreatePlan = {
  notes: CreateNoteInstruction[];
  explanation: string;
};

export function createCreateTool() {
  const createSchema = z.object({
    notes: z
      .array(
        z.object({
          filePath: z
            .string()
            .min(1)
            .describe(
              'The full path (including file name) for the note to create. Include the .md extension.'
            ),
          content: z
            .string()
            .optional()
            .describe('The Markdown content that should be written to the note after creation.'),
        })
      )
      .min(1)
      .describe('The list of notes that must be created.'),
    explanation: z
      .string()
      .describe('A short explanation of what is being created and why it is necessary.'),
  });

  const createTool = tool({
    parameters: createSchema,
  });

  function execute(args: CreateToolArgs): CreatePlan {
    const normalizedNotes: CreateNoteInstruction[] = [];

    for (const note of args.notes) {
      const trimmedPath = note.filePath.trim();
      const filePath = trimmedPath.endsWith('.md') ? trimmedPath : `${trimmedPath}.md`;

      normalizedNotes.push({
        filePath,
        content: note.content && note.content.trim().length > 0 ? note.content : undefined,
      });
    }

    return {
      notes: normalizedNotes,
      explanation: args.explanation,
    };
  }

  return {
    createSchema,
    createTool,
    execute,
  };
}
