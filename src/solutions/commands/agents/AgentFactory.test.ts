import { createAgentFromConfig } from './AgentFactory';
import { DEFAULT_AGENT_CONFIGS } from './defaultAgents';
import { SuperAgent } from './SuperAgent/SuperAgent';
import { UDCAgent } from './UDCAgent/UDCAgent';
import { ConversationTitleAgent } from './ConversationTitleAgent/ConversationTitleAgent';
import { CompactionSummaryAgent } from './CompactionSummaryAgent/CompactionSummaryAgent';
import type { AgentConfig } from './AgentConfig';
import type StewardPlugin from 'src/main';

function createMockPlugin(): StewardPlugin {
  return {} as unknown as StewardPlugin;
}

function getAgentConfig(id: string): AgentConfig {
  const config = DEFAULT_AGENT_CONFIGS.find(c => c.id === id);
  if (!config) {
    throw new Error(`Agent config not found: ${id}`);
  }
  return config;
}

describe('AgentFactory', () => {
  const plugin = createMockPlugin();

  describe('createAgentFromConfig', () => {
    it('should create SuperAgent for factory super', () => {
      const config = getAgentConfig('super');
      const agent = createAgentFromConfig(plugin, config);
      expect(agent).toBeInstanceOf(SuperAgent);
    });

    it('should create SuperAgent with tools for search config', () => {
      const config = getAgentConfig('search');
      const agent = createAgentFromConfig(plugin, config);
      expect(agent).toBeInstanceOf(SuperAgent);
    });

    it('should create UDCAgent for factory udc', () => {
      const config = getAgentConfig('udc');
      const agent = createAgentFromConfig(plugin, config);
      expect(agent).toBeInstanceOf(UDCAgent);
    });

    it('should create ConversationTitleAgent for factory title', () => {
      const config = getAgentConfig('title');
      const agent = createAgentFromConfig(plugin, config);
      expect(agent).toBeInstanceOf(ConversationTitleAgent);
    });

    it('should create CompactionSummaryAgent for factory compaction_summary', () => {
      const config = getAgentConfig('compaction_summary');
      const agent = createAgentFromConfig(plugin, config);
      expect(agent).toBeInstanceOf(CompactionSummaryAgent);
    });

    it('should throw for unknown factory', () => {
      const invalidConfig = {
        id: 'invalid',
        factory: 'invalid',
      } as unknown as Parameters<typeof createAgentFromConfig>[1];
      expect(() => createAgentFromConfig(plugin, invalidConfig)).toThrow(/Unknown agent factory/);
    });
  });
});
