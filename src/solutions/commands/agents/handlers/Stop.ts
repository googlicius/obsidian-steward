import { tool } from 'ai';
import { z } from 'zod';
import { type SuperAgent } from '../SuperAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { delay } from 'src/utils/delay';

// STOP tool doesn't need args
const stopSchema = z.object({});

export type StopArgs = z.infer<typeof stopSchema>;

export class Stop {
  private static readonly stopTool = tool({
    parameters: stopSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getStopTool() {
    return Stop.stopTool;
  }

  /**
   * Handle stop tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, StopArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('Stop.handle invoked without handlerId');
    }

    // Get the count of active operations before stopping
    const activeOperationsCount = this.agent.plugin.abortService.getActiveOperationsCount();

    this.agent.plugin.abortService.abortAllOperations();

    // Log the action
    logger.log(`Stop command received - aborted all operations (${activeOperationsCount} active)`);

    // Prepare the response message
    let responseMessage = t('stop.stopped');

    // Add count of operations if there were any
    if (activeOperationsCount > 0) {
      responseMessage = t('stop.stoppedWithCount', { count: activeOperationsCount });
    } else {
      responseMessage = t('stop.noActiveOperations');
    }

    await delay(800);

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: responseMessage,
      lang,
      handlerId,
    });

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }
}
