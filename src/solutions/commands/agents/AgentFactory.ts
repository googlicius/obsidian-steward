import type StewardPlugin from 'src/main';
import { SuperAgent } from './SuperAgent/SuperAgent';
import { SubAgent } from './SubAgent/SubAgent';
import { UDCAgent } from './UDCAgent/UDCAgent';
import { ConversationTitleAgent } from './ConversationTitleAgent/ConversationTitleAgent';
import { CompactionSummaryAgent } from './CompactionSummaryAgent/CompactionSummaryAgent';
import type { AgentConfig } from './AgentConfig';
import { ToolName } from '../ToolRegistry';

/** Agent types created by the factory (SuperAgent/UDCAgent extend Agent; title/compaction are standalone). */
export type AgentFactoryProduct =
  | SuperAgent
  | SubAgent
  | UDCAgent
  | ConversationTitleAgent
  | CompactionSummaryAgent;

/**
 * Create an agent instance from config.
 * Used by AgentRunner (Phase 2) to instantiate agents by id.
 */
export function createAgentFromConfig(
  plugin: StewardPlugin,
  config: AgentConfig
): AgentFactoryProduct {
  const tools = (config.tools ?? []).map(t => t as ToolName);

  switch (config.factory) {
    case 'super':
      return new SuperAgent(plugin, tools);
    case 'subagent':
      return new SubAgent(plugin, tools);
    case 'udc':
      return new UDCAgent(plugin);
    case 'title':
      return new ConversationTitleAgent(plugin);
    case 'compaction_summary':
      return new CompactionSummaryAgent(plugin);
    default: {
      const _exhaustive: never = config.factory;
      throw new Error(`Unknown agent factory: ${_exhaustive as string}`);
    }
  }
}
