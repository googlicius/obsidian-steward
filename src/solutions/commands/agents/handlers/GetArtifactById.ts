import { tool } from 'ai';
import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';

const getArtifactByIdSchema = z.object({
  artifactId: z.string().min(1).describe('The ID of the artifact to retrieve.'),
});

export type GetArtifactByIdArgs = z.infer<typeof getArtifactByIdSchema>;

export class GetArtifactById {
  private static readonly getArtifactByIdTool = tool({
    inputSchema: getArtifactByIdSchema,
  });

  constructor(private readonly agent: AgentHandlerContext) {}

  public static getGetArtifactByIdTool() {
    return GetArtifactById.getArtifactByIdTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<GetArtifactByIdArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('GetArtifactById.handle invoked without handlerId');
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.input.artifactId);

    const result = artifact?.id
      ? `artifactRef:${artifact.id}`
      : t('common.artifactNotFound', { artifactId: toolCall.input.artifactId });

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'get-artifact',
      handlerId,
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
