import { z } from 'zod/v3';

export const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  default: z.boolean().optional(),
  /** Factory: 'super' | 'udc' | 'title' | 'compaction_summary' */
  factory: z.enum(['super', 'udc', 'title', 'compaction_summary']),
  /** For factory 'super': tools to activate. Empty = all tools. */
  tools: z.array(z.string()).optional(),
  /** For factory 'udc': UDC command ID */
  udcCommandId: z.string().optional(),
  /** Whether content is required for this agent */
  contentRequired: z.boolean().optional(),
  /** Whether this agent is allowed to use tools (default: true). */
  canUseTools: z.boolean().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
