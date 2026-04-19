import { z } from 'zod/v3';
import type { MCPClient } from '@ai-sdk/mcp';

export const mcpServerConfigSchema = z.object({
  transport: z.enum(['http', 'sse']),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
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
  /** Tool names from MCP `list_tools`, persisted in note frontmatter `tools` (JSON array). */
  cachedToolNames: string[];
  /** Last connection outcome / retry hint; frontmatter `connection_message`. */
  connectionMessage: string;
}

export interface MCPConnectedServer {
  definitionPath: string;
  client: MCPClient;
  tools: Record<string, unknown>;
}

/** Per-definition MCP session: live connection or a failed attempt (no retries until cache cleared). */
export type MCPConnectionCacheEntry =
  | { kind: 'connected'; server: MCPConnectedServer }
  | { kind: 'failed' };
