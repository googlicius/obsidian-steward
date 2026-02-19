import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { revertAbleArtifactTypes } from 'src/solutions/artifact';

const getMostRecentArtifactSchema = z.object({});

export type GetMostRecentArtifactArgs = z.infer<typeof getMostRecentArtifactSchema>;

export class GetMostRecentArtifact {
  private static readonly getMostRecentArtifactTool = tool({
    inputSchema: getMostRecentArtifactSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getGetMostRecentArtifactTool() {
    return GetMostRecentArtifact.getMostRecentArtifactTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<GetMostRecentArtifactArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('GetMostRecentArtifact.handle invoked without handlerId');
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes(revertAbleArtifactTypes);

    const result = artifact?.id
      ? `artifactRef:${artifact.id}`
      : t('common.noArtifactsFound');

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
