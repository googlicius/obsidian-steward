import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { revertAbleArtifactTypes } from 'src/solutions/artifact';

const { getTranslation } = getBundledInternal('i18n');

const getMostRecentArtifactSchema = z.object({});

export type GetMostRecentArtifactArgs = z.infer<typeof getMostRecentArtifactSchema>;

export class GetMostRecentArtifact {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getGetMostRecentArtifactTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: getMostRecentArtifactSchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<GetMostRecentArtifactArgs> }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const { toolCall } = options;
    const t = getTranslation(ctx.lang);

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes(revertAbleArtifactTypes);

    const result = artifact?.id ? `artifactRef:${artifact.id}` : t('common.noArtifactsFound');

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'get-artifact',
      handlerId: ctx.handlerId,
      step: ctx.step,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'text',
            value: result,
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
