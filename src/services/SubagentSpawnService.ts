import type StewardPlugin from 'src/main';
import { getLanguage } from 'obsidian';
import { uniqueID } from 'src/utils/uniqueID';
import type { AgentConfig } from 'src/solutions/commands/agents/AgentConfig';
import { DEFAULT_AGENT_CONFIGS } from 'src/solutions/commands/agents/defaultAgents';
import { createAgentFromConfig } from 'src/solutions/commands/agents/AgentFactory';
import type { Agent } from 'src/solutions/commands/Agent';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import type { AgentHandlerParams } from 'src/solutions/commands/types';
import { DEFAULT_INTENT_TYPE } from 'src/solutions/commands/agents/intentHelpers';

export interface SpawnSubagentJob {
  task: string;
  tools?: ToolName[];
  inactiveTools?: ToolName[];
  systemPrompts?: string[];
}

export interface SubagentRunResult {
  childTitle: string;
  task: string;
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
    return product;
  }

  private buildChildTitle(parentTitle: string): string {
    return `${parentTitle}__subagent_${uniqueID()}`;
  }

  private mergeActiveTools(defaultTools?: ToolName[], jobTools?: ToolName[]): ToolName[] {
    const merged = new Set<ToolName>([...(defaultTools || []), ...(jobTools || [])]);
    if (merged.size === 0) {
      merged.add(ToolName.ACTIVATE);
    }
    return Array.from(merged);
  }

  private async extractChildSummary(childTitle: string): Promise<string> {
    const messages =
      await this.plugin.conversationRenderer.extractAllConversationMessages(childTitle);
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
    parentAgentId: string;
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
          task: job.task,
          status: 'failed',
          summary: '',
          error: 'Subagent is not runnable.',
        };
      }

      await params.onStatus?.('queued', {
        childTitle,
        task: job.task,
      });

      const conversationLanguage = params.lang || getLanguage();
      const indicatorText = this.plugin.conversationRenderer.getIndicatorTextByIntentType(
        DEFAULT_INTENT_TYPE,
        conversationLanguage
      );
      await this.plugin.conversationRenderer.createConversationNote(childTitle, {
        intent: {
          type: DEFAULT_INTENT_TYPE,
          query: job.task,
        },
        properties: [
          { name: 'lang', value: conversationLanguage },
          { name: 'indicator_text', value: indicatorText },
        ],
      });
      await this.plugin.conversationRenderer.updateConversationFrontmatter(childTitle, [
        { name: 'parent', value: params.parentAgentId },
      ]);

      await params.onStatus?.('running', {
        childTitle,
        task: job.task,
      });

      try {
        const mergedActiveTools = this.mergeActiveTools(params.defaultTools, job.tools);
        const childParams: AgentHandlerParams = {
          title: childTitle,
          intent: {
            type: DEFAULT_INTENT_TYPE,
            query: job.task,
            no_confirm: true,
            systemPrompts: [...(params.defaultSystemPrompts || []), ...(job.systemPrompts || [])],
          },
          lang: params.lang,
          handlerId: params.handlerId,
          // Child agent iterations are independent from the parent invocation step.
          invocationCount: 0,
          activeTools: mergedActiveTools,
          inactiveTools: job.inactiveTools,
        };

        await childAgent.safeHandle(childParams);
        const summary = await this.extractChildSummary(childTitle);
        const done: SubagentRunResult = {
          childTitle,
          task: job.task,
          status: 'done',
          summary,
        };
        await params.onStatus?.('done', done);
        return done;
      } catch (error) {
        const failure: SubagentRunResult = {
          childTitle,
          task: job.task,
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
