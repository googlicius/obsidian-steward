import { ToolName } from '../ToolRegistry';
import type { AgentConfig } from './AgentConfig';

export const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'super',
    name: 'Super Agent',
    default: true,
    factory: 'super',
    tools: [], // All tools
    canUseTools: true,
  },
  {
    id: 'udc',
    name: 'User-Defined Commands',
    factory: 'udc',
    canUseTools: true,
  },
  {
    id: 'search',
    name: 'Search Agent',
    factory: 'super',
    tools: [ToolName.SEARCH],
    canUseTools: true,
  },
  {
    id: 'speech',
    name: 'Speech Agent',
    factory: 'super',
    tools: [ToolName.SPEECH],
    canUseTools: true,
  },
  {
    id: 'image',
    name: 'Image Agent',
    factory: 'super',
    tools: [ToolName.IMAGE],
    canUseTools: true,
  },
  {
    id: 'title',
    name: 'Conversation Title Agent',
    factory: 'title',
    canUseTools: false,
  },
  {
    id: 'compaction_summary',
    name: 'Compaction Summary Agent',
    factory: 'compaction_summary',
    canUseTools: false,
  },
];
