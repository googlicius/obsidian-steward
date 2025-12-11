import { tool } from 'ai';
import { z } from 'zod';
import { ToolName } from '../ToolRegistry';
import { joinWithConjunction } from 'src/utils/arrayUtils';

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

/**
 * Result type for activate tools validation
 */
export interface ActivateToolsResult {
  message: string;
  activatedTools?: ToolName[];
  invalidTools?: ToolName[];
}

/**
 * Execute activate tools - validates that requested tools exist in the available tool set
 */
export async function execute(
  args: ActivateToolsArgs,
  availableTools: Record<string, unknown>
): Promise<ActivateToolsResult> {
  const { tools } = args;

  // Get the set of available tool names
  const availableToolNames = new Set(Object.keys(availableTools) as ToolName[]);

  // Find invalid tools (tools that don't exist in the available tool set)
  const invalidTools = tools.filter(tool => !availableToolNames.has(tool));

  if (invalidTools.length > 0) {
    const validTools = tools.filter(tool => availableToolNames.has(tool));

    return {
      message: `The ${joinWithConjunction(invalidTools, 'and')} tool(s) are not available in the current tool set.`,
      invalidTools,
      activatedTools: validTools.length > 0 ? validTools : undefined,
    };
  }

  return {
    message: `Requested tools ${joinWithConjunction(tools, 'and')} are now activated.`,
    activatedTools: tools,
  };
}
