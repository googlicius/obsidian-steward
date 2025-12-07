import { tool } from 'ai';
import { z } from 'zod';
import { ToolName } from '../ToolRegistry';

const activateToolsSchema = z.object({
  tools: z
    .array(z.nativeEnum(ToolName))
    .min(1)
    .describe(
      'List of tool names that should be activated for the current task. Only include tools that are currently inactive.'
    ),
});

export type ActivateToolsArgs = z.infer<typeof activateToolsSchema>;

export const activateTools = tool({
  parameters: activateToolsSchema,
});
