import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { getBundledInternal } from 'src/utils/bundledInternals';

const { getTranslation } = getBundledInternal('i18n');

const getArtifactByIdSchema = z.object({
  artifactId: z.string().min(1).describe('The ID of the artifact to retrieve.'),
});

export type GetArtifactByIdArgs = z.infer<typeof getArtifactByIdSchema>;

export class GetArtifactById {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getGetArtifactByIdTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: getArtifactByIdSchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<GetArtifactByIdArgs> }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const { toolCall } = options;
    const t = getTranslation(ctx.lang);

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.input.artifactId);

    const result = artifact?.id
      ? `artifactRef:${artifact.id}`
      : t('common.artifactNotFound', { artifactId: toolCall.input.artifactId });

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
