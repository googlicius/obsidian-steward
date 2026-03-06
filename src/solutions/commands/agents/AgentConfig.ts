import { z } from 'zod/v3';

export const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  default: z.boolean().optional(),
  /** Factory: 'super' | 'subagent' | 'udc' | 'title' | 'compaction_summary' */
  factory: z.enum(['super', 'subagent', 'udc', 'title', 'compaction_summary']),
  /** For factory 'super': tools to activate. Empty = all tools. */
  tools: z.array(z.string()).optional(),
  /** For factory 'udc': UDC command ID */
  udcCommandId: z.string().optional(),
  /** Whether content is required for this agent */
  contentRequired: z.boolean().optional(),
  /** Whether this agent is allowed to use tools (default: true). */
  canUseTools: z.boolean().optional(),
  /** Whether this agent can spawn subagents. */
  canSpawnSubagents: z.boolean().optional(),
  /** Allowed child agent IDs this agent may spawn. */
  allowedSubagents: z.array(z.string()).optional(),
  /** Default tools to pass to spawned subagents. */
  subagentTools: z.array(z.string()).optional(),
  /** Default system prompts to pass to spawned subagents. */
  subagentSystemPrompts: z.array(z.string()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
