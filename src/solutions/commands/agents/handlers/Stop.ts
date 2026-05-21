import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';
import { delay } from 'src/utils/delay';

const { getTranslation } = getBundledInternal('i18n');

// STOP tool doesn't need args
const stopSchema = z.object({});

export type StopArgs = z.infer<typeof stopSchema>;

export class Stop {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getStopTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: stopSchema,
    });
  }

  /**
   * Handle stop tool call
   */
  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<StopArgs> }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const t = getTranslation(ctx.lang);

    // Get the count of active operations before stopping
    const activeOperationsCount = this.agent.plugin.abortService.getActiveOperationsCount(title);

    this.agent.plugin.abortService.abortConversation(title);

    logger.log(
      `Stop command received - aborted operations for conversation (${activeOperationsCount} active before stop)`
    );

    // Prepare the response message
    let responseMessage = t('stop.stopped');

    // Add count of operations if there were any
    if (activeOperationsCount > 0) {
      responseMessage = t('stop.stoppedWithCount', { count: activeOperationsCount });
    } else {
      responseMessage = t('stop.noActiveOperations');
    }

    await delay(800);

    await ctx.updateConversationNote({
      newContent: responseMessage,
    });

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }
}
