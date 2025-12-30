import { tool } from 'ai';
import { z } from 'zod/v3';
import { ToolName } from '../ToolRegistry';
import { joinWithConjunction } from 'src/utils/arrayUtils';

const activateToolsSchema = z.object({
  tools: z
    .array(z.nativeEnum(ToolName))
    .optional()
    .describe(
      'List of tool names that should be activated for the current task. Only include tools that are currently inactive.'
    ),
  deactivate: z
    .array(z.nativeEnum(ToolName))
    .optional()
    .describe(
      'List of tool names that should be deactivated. Use this to simplify the guidelines and tool schemas when tools are no longer needed.'
    ),
});

export type ActivateToolsArgs = z.infer<typeof activateToolsSchema>;

export const activateTools = tool({
  inputSchema: activateToolsSchema,
});

/**
 * Result type for activate tools validation
 */
export interface ActivateToolsResult {
  message: string;
  activatedTools?: ToolName[];
  deactivatedTools?: ToolName[];
  invalidTools?: ToolName[];
  invalidDeactivateTools?: ToolName[];
}

/**
 * Execute activate tools - validates that requested tools exist in the available tool set
 */
export async function execute(
  args: ActivateToolsArgs,
  availableTools: Record<string, unknown>,
  activeTools: ToolName[]
): Promise<ActivateToolsResult> {
  const { tools = [], deactivate = [] } = args;
  const messages: string[] = [];

  // Get the set of available tool names
  const availableToolNames = new Set(Object.keys(availableTools) as ToolName[]);
  const activeToolNames = new Set(activeTools);

  // Process activation
  const invalidTools = tools.filter(tool => !availableToolNames.has(tool));
  const validToolsToActivate = tools.filter(tool => availableToolNames.has(tool));

  // Process deactivation - only deactivate tools that are currently active
  const invalidDeactivateTools = deactivate.filter(tool => !activeToolNames.has(tool));
  const validToolsToDeactivate = deactivate.filter(tool => activeToolNames.has(tool));

  // Build result messages
  if (validToolsToActivate.length > 0) {
    messages.push(`Activated: ${joinWithConjunction(validToolsToActivate, 'and')}.`);
  }
  if (validToolsToDeactivate.length > 0) {
    messages.push(`Deactivated: ${joinWithConjunction(validToolsToDeactivate, 'and')}.`);
  }
  if (invalidTools.length > 0) {
    messages.push(`Cannot activate ${joinWithConjunction(invalidTools, 'and')} (not available).`);
  }
  if (invalidDeactivateTools.length > 0) {
    messages.push(
      `Cannot deactivate ${joinWithConjunction(invalidDeactivateTools, 'and')} (not currently active).`
    );
  }

  if (messages.length === 0) {
    messages.push('No tools to activate or deactivate.');
  }

  return {
    message: messages.join(' '),
    activatedTools: validToolsToActivate.length > 0 ? validToolsToActivate : undefined,
    deactivatedTools: validToolsToDeactivate.length > 0 ? validToolsToDeactivate : undefined,
    invalidTools: invalidTools.length > 0 ? invalidTools : undefined,
    invalidDeactivateTools: invalidDeactivateTools.length > 0 ? invalidDeactivateTools : undefined,
  };
}
