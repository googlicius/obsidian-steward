import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { createTextStream } from 'src/utils/textStreamer';
import { ArtifactType } from 'src/solutions/artifact';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ToolName } from '../../toolNames';

const concludeSchema = z.object({
  conclusion: z.string().describe('A brief conclusion text summarizing what you have done.'),
  parallelToolName: z
    .string()
    .describe(
      'The name of the tool you are calling in parallel with conclude. This tool must not be called alone.'
    ),
  validation: z
    .object({
      expectedArtifactType: z
        .string()
        .optional()
        .describe(
          'The expected artifact type created by the parallel tool. Used to verify the operation succeeded.'
        ),
    })
    .describe('Criteria to validate the result of the parallel tool call.'),
});

export type ConcludeInput = z.infer<typeof concludeSchema>;

export class Conclude {
  private static readonly concludeTool = tool({
    inputSchema: concludeSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getConcludeTool() {
    return Conclude.concludeTool;
  }

  /**
   * Handle conclude tool call.
   * Validates artifact criteria. If validation passes, streams the conclusion
   * text and signals stop. If validation fails, serializes a failure message
   * so the AI is aware and does not retry the conclude tool.
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<ConcludeInput>;
    }
  ): Promise<AgentResult> {
    const { title, handlerId, lang } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('Conclude.handle invoked without handlerId');
    }

    // Schema-based validation: check expected artifact type
    if (!(await this.validateArtifactCriteria(title, toolCall.input))) {
      const t = getTranslation(lang);
      const failureMessage = t('conclude.validationFailed');

      await this.agent.serializeInvocation({
        title,
        handlerId,
        command: 'conclude',
        toolCall,
        step: params.invocationCount,
        result: {
          type: 'text',
          value: failureMessage,
        },
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    const { conclusion } = toolCall.input;

    if (!conclusion || conclusion.trim().length === 0) {
      return {
        status: IntentResultStatus.STOP_PROCESSING,
      };
    }

    await this.agent.serializeInvocation({
      title,
      handlerId,
      command: 'conclude',
      toolCall,
      step: params.invocationCount,
      result: {
        type: 'json',
        value: 'Validation passed and the conclusion is rendered.',
      },
    });

    // Stream the conclusion text using textStreamer
    const textStream = createTextStream(conclusion);

    await this.agent.renderer.streamConversationNote({
      path: title,
      stream: textStream,
      handlerId,
      step: params.invocationCount,
      command: 'conclude',
      includeHistory: false,
    });

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }

  /**
   * Validate the result of previous tool calls based on schema-defined criteria.
   */
  private async validateArtifactCriteria(
    title: string,
    concludeInput: ConcludeInput
  ): Promise<boolean> {
    if (!concludeInput.validation.expectedArtifactType) {
      switch (concludeInput.parallelToolName) {
        case ToolName.TODO_LIST_UPDATE:
          return true;

        default:
          return false;
      }
    }
    const latestArtifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes([
        concludeInput.validation.expectedArtifactType as ArtifactType,
      ]);

    if (!latestArtifact) {
      logger.warn('Conclude: expected artifact type not found', {
        expectedArtifactType: concludeInput.validation.expectedArtifactType,
      });
      return false;
    }

    return true;
  }
}
