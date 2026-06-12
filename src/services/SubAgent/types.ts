import { z } from 'zod/v3';
import { ToolName } from 'src/solutions/commands/toolNames';

export const subAgentDefinitionBlockSchema = z.object({
  name: z.literal('agent'),
  id: z.string().min(1),
  description: z.string().min(1),
  instruction: z.string().min(1),
  model: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  tools: z.array(z.nativeEnum(ToolName)).optional(),
  inactiveTools: z.array(z.nativeEnum(ToolName)).optional(),
});

export type SubAgentDefinitionBlock = z.infer<typeof subAgentDefinitionBlockSchema>;

export interface SubAgentDefinition {
  id: string;
  description: string;
  instruction: string;
  model?: string;
  enabled: boolean;
  tools?: ToolName[];
  inactiveTools?: ToolName[];
}

export interface SubAgentCatalogEntry {
  id: string;
  description: string;
}

export interface SubAgentDefinitionValidationResult {
  valid: boolean;
  errors: string[];
  statusMessage: string;
  definitionsById: Map<string, SubAgentDefinition>;
}
