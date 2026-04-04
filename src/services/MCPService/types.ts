import { z } from 'zod/v3';
import type { MCPClient } from '@ai-sdk/mcp';

export const mcpServerConfigSchema = z.object({
  transport: z.enum(['http', 'sse']),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().optional().default(true),
});

export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>;

export interface MCPDefinition {
  path: string;
  serverId: string;
  name: string;
  description: string;
  enabled: boolean;
  message: string;
  config: MCPServerConfig | null;
}

export interface MCPConnectedServer {
  definitionPath: string;
  client: MCPClient;
  tools: Record<string, unknown>;
}
