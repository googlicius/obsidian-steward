import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ArtifactType } from 'src/solutions/artifact';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ToolName } from '../../toolNames';

export const concludeSchema = z.object({
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
    .transform(value => {
      let expectedArtifactType = value.expectedArtifactType;
      // Ignore these "artifact type" as they're not exist
      if (
        expectedArtifactType &&
        ['todo_list', 'todo_list_update', 'todo_list_update_results'].includes(expectedArtifactType)
      ) {
        expectedArtifactType = undefined;
      }
      return { ...value, expectedArtifactType };
    })
    .describe('Criteria to validate the result of the parallel tool call.'),
});

export type ConcludeInput = z.infer<typeof concludeSchema>;

export class Conclude {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getConcludeTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: concludeSchema,
    });
  }

  /**
   * Handle conclude tool call.
   * Validates artifact criteria. If validation passes, signals stop.
   * If validation fails, serializes a failure message so the AI is aware
   * and does not retry the conclude tool.
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

    await this.agent.serializeInvocation({
      title,
      handlerId,
      command: 'conclude',
      toolCall,
      step: params.invocationCount,
      result: {
        type: 'json',
        value: 'Validation passed. Task completed successfully.',
      },
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
      // Empty parallelToolName means unconditional conclude (e.g. from command syntax c:conclude)
      if (!concludeInput.parallelToolName) {
        return true;
      }

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
