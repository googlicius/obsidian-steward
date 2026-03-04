import type StewardPlugin from 'src/main';
import { uniqueID } from 'src/utils/uniqueID';
import type { AgentConfig } from 'src/solutions/commands/agents/AgentConfig';
import { DEFAULT_AGENT_CONFIGS } from 'src/solutions/commands/agents/defaultAgents';
import { createAgentFromConfig } from 'src/solutions/commands/agents/AgentFactory';
import type { Agent } from 'src/solutions/commands/Agent';
import type { ToolName } from 'src/solutions/commands/ToolRegistry';
import type { AgentHandlerParams } from 'src/solutions/commands/types';
import { DEFAULT_INTENT_TYPE } from 'src/solutions/commands/agents/intentHelpers';

export interface SpawnSubagentJob {
  query: string;
  tools?: ToolName[];
  systemPrompts?: string[];
}

export interface SubagentRunResult {
  childTitle: string;
  query: string;
  status: 'done' | 'failed';
  summary: string;
  error?: string;
}

export class SubagentSpawnService {
  constructor(
    private readonly plugin: StewardPlugin,
    private readonly agentConfigs: AgentConfig[] = DEFAULT_AGENT_CONFIGS
  ) {}

  private resolveAgentConfig(agentId: string): AgentConfig | null {
    const config = this.agentConfigs.find(item => item.id === agentId);
    return config || null;
  }

  private toRunnableAgent(config: AgentConfig): Agent | null {
    const product = createAgentFromConfig(this.plugin, config);
    if (!('safeHandle' in product) || typeof product.safeHandle !== 'function') {
      return null;
    }
    return product as Agent;
  }

  private buildChildTitle(parentTitle: string): string {
    return `${parentTitle}__subagent_${uniqueID()}`;
  }

  private async extractChildSummary(childTitle: string): Promise<string> {
    const messages = await this.plugin.conversationRenderer.extractAllConversationMessages(childTitle);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.content.trim().length > 0) {
        return message.content.trim();
      }
    }
    return '';
  }

  public async runJobs(params: {
    parentTitle: string;
    jobs: SpawnSubagentJob[];
    lang?: string | null;
    handlerId: string;
    step?: number;
    onStatus?: (
      status: 'queued' | 'running' | 'done' | 'failed',
      patch?: Partial<SubagentRunResult>
    ) => Promise<void>;
    defaultTools?: ToolName[];
    defaultSystemPrompts?: string[];
  }): Promise<SubagentRunResult[]> {
    const config = this.resolveAgentConfig('subagent');
    if (!config) {
      return [];
    }

    const executeJob = async (job: SpawnSubagentJob): Promise<SubagentRunResult> => {
      const childTitle = this.buildChildTitle(params.parentTitle);
      const childAgent = this.toRunnableAgent(config);
      if (!childAgent) {
        return {
          childTitle,
          query: job.query,
          status: 'failed',
          summary: '',
          error: 'Subagent is not runnable.',
        };
      }

      await params.onStatus?.('queued', {
        childTitle,
        query: job.query,
      });

      await this.plugin.conversationRenderer.createConversationNote(
        childTitle,
        DEFAULT_INTENT_TYPE,
        job.query,
        params.lang || undefined
      );

      await params.onStatus?.('running', {
        childTitle,
        query: job.query,
      });

      try {
        const childParams: AgentHandlerParams = {
          title: childTitle,
          intent: {
            type: DEFAULT_INTENT_TYPE,
            query: job.query,
            systemPrompts: [
              ...(params.defaultSystemPrompts || []),
              ...(job.systemPrompts || []),
            ],
          },
          lang: params.lang,
          handlerId: params.handlerId,
          // Child agent iterations are independent from the parent invocation step.
          invocationCount: 0,
          activeTools: [...(params.defaultTools || []), ...(job.tools || [])],
        };

        await childAgent.safeHandle(childParams);
        const summary = await this.extractChildSummary(childTitle);
        const done: SubagentRunResult = {
          childTitle,
          query: job.query,
          status: 'done',
          summary,
        };
        await params.onStatus?.('done', done);
        return done;
      } catch (error) {
        const failure: SubagentRunResult = {
          childTitle,
          query: job.query,
          status: 'failed',
          summary: '',
          error: error instanceof Error ? error.message : String(error),
        };
        await params.onStatus?.('failed', failure);
        return failure;
      }
    };

    return Promise.all(params.jobs.map(job => executeJob(job)));
  }
}
