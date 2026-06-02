import { z } from 'zod/v3';
import { ToolName } from 'src/solutions/commands/toolNames';

const toolNameValues = Object.values(ToolName) as [ToolName, ...ToolName[]];

export const toolInstructionBlockSchema = z.object({
  name: z.literal('tool_instruction'),
  tool: z.enum(toolNameValues),
  enabled: z.boolean().optional().default(true),
  guidelines: z.array(z.string().min(1)).min(1),
});

export type ToolInstructionBlock = z.infer<typeof toolInstructionBlockSchema>;

export interface ToolInstructionValidationResult {
  valid: boolean;
  errors: string[];
  statusMessage: string;
  guidelinesByTool: Map<ToolName, string[]>;
}
