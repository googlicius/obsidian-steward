import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { type SpawnSubagentJob } from 'src/services/SubAgent';
import { DEFAULT_AGENT_CONFIGS } from '../defaultAgents';

const { getTranslation } = getBundledInternal('i18n');

const spawnSubagentSchema = z.object({
  jobs: z
    .array(
      z.object({
        task: z.string().min(1),
        agent_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Sub-agent id from Steward/Sub Agents.md (e.g. image_vision). When provided, leave tools, systemPrompts, and inactiveTools empty; they are filled from the definition.'
          ),
        tools: z.array(z.string()).optional(),
        inactiveTools: z.array(z.string()).optional(),
        systemPrompts: z.array(z.string()).optional(),
      })
    )
    .min(1),
});

export type SpawnSubagentArgs = z.infer<typeof spawnSubagentSchema>;

interface SpawnRunState {
  childTitle: string;
  task: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  summary?: string;
  error?: string;
}

export class SpawnSubagent {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getSpawnSubagentTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: spawnSubagentSchema,
    });
  }

  private async updateRunState(title: string, runPatch: SpawnRunState): Promise<void> {
    const existingRuns =
      (await this.agent.renderer.getConversationProperty<SpawnRunState[]>(
        title,
        'subagent_runs'
      )) || [];
    const nextRuns = [...existingRuns];
    const index = nextRuns.findIndex(item => item.childTitle === runPatch.childTitle);
    if (index === -1) {
      nextRuns.push(runPatch);
    } else {
      nextRuns[index] = { ...nextRuns[index], ...runPatch };
    }

    await this.agent.renderer.updateConversationFrontmatter(title, [
      {
        name: 'subagent_runs',
        value: nextRuns,
      },
    ]);
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: {
      toolCall: ToolCallPart<SpawnSubagentArgs>;
      parentAgentId?: string;
    }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const { toolCall, parentAgentId = 'super' } = options;
    const t = getTranslation(ctx.lang);

    const parentConfig = DEFAULT_AGENT_CONFIGS.find(config => config.id === parentAgentId);
    const canSpawnSubagents = parentConfig?.canSpawnSubagents === true;
    if (!canSpawnSubagents) {
      await ctx.serializeInvocation({
        command: ToolName.SPAWN_SUBAGENT,
        toolCall,
        result: {
          type: 'error-text',
          value: `Agent "${parentAgentId}" is not allowed to spawn subagents.`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const normalizedJobs: SpawnSubagentJob[] = [];
    for (let i = 0; i < toolCall.input.jobs.length; i++) {
      const job = toolCall.input.jobs[i];
      if (job.agent_id) {
        const definition = this.agent.plugin.subAgentDefinitionService.getDefinition(job.agent_id);
        if (!definition) {
          await ctx.serializeInvocation({
            command: ToolName.SPAWN_SUBAGENT,
            toolCall,
            result: {
              type: 'error-text',
              value: `Unknown sub-agent "${job.agent_id}". Check Steward/Sub Agents.md for available agent ids.`,
            },
          });
          return { status: IntentResultStatus.SUCCESS };
        }

        normalizedJobs.push({
          task: job.task,
          agentId: job.agent_id,
          tools: definition.tools,
          inactiveTools: definition.inactiveTools,
          systemPrompts: [definition.instruction],
          model: definition.model,
        });
        continue;
      }

      normalizedJobs.push({
        task: job.task,
        tools: job.tools as ToolName[] | undefined,
        inactiveTools: job.inactiveTools as ToolName[] | undefined,
        systemPrompts: job.systemPrompts,
      });
    }

    await this.agent.renderer.addGeneratingIndicator(title, t('conversation.working'));

    const runs = await this.agent.plugin.subAgentSpawnService.runJobs({
      parentTitle: title,
      parentAgentId,
      jobs: normalizedJobs,
      lang: ctx.lang,
      handlerId: ctx.handlerId,
      step: ctx.step,
      defaultTools: (parentConfig.subagentTools || []) as ToolName[],
      defaultSystemPrompts: parentConfig.subagentSystemPrompts || [],
      onStatus: async (status, patch) => {
        if (status === 'running') {
          if (patch?.childTitle) {
            const subagentEmbed = this.agent.plugin.noteContentService.formatCallout(
              `![[${patch.childTitle}]]`,
              'stw-review',
              { streaming: 'true' }
            );
            await ctx.updateConversationNote({
              newContent: subagentEmbed,
              includeHistory: false,
            });
          }
        }

        await this.updateRunState(title, {
          childTitle: patch?.childTitle || '',
          task: patch?.task || '',
          status,
          summary: patch?.summary,
          error: patch?.error,
        });
      },
    });

    const succeeded = runs.filter(run => run.status === 'done');
    const failed = runs.filter(run => run.status === 'failed');

    await ctx.serializeInvocation({
      command: ToolName.SPAWN_SUBAGENT,
      toolCall,
      result: {
        type: 'json',
        value: {
          total: runs.length,
          completed: succeeded.length,
          failed: failed.length,
          runs: runs.map(run => ({
            childTitle: run.childTitle,
            task: run.task,
            status: run.status,
            summary: run.summary,
            error: run.error,
          })),
        },
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
