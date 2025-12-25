import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';
import {
  execute as executeActivateTools,
  ActivateToolsResult,
  ActivateToolsArgs,
} from '../../tools/activateTools';
import { ToolCallPart } from '../../tools/types';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getTranslation } from 'src/i18n';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { removeUndefined } from 'src/utils/removeUndefined';

/**
 * Handles the ACTIVATE tool logic shared across agents
 */
export class ActivateToolHandler {
  constructor(private readonly renderer: ConversationRenderer) {}

  /**
   * Process an ACTIVATE tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<unknown>;
      activeTools: ToolName[];
      availableTools: Record<string, unknown>;
      agent: string;
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall, activeTools, availableTools, agent } = options;
    const input = toolCall.input as ActivateToolsArgs;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('ActivateToolHandler.handle invoked without handlerId');
    }

    // Validate and process tools
    const validationResult: ActivateToolsResult = await executeActivateTools(
      input,
      availableTools,
      activeTools
    );

    // Activate valid tools
    if (validationResult.activatedTools && validationResult.activatedTools.length > 0) {
      activeTools.push(...validationResult.activatedTools);
    }

    // Deactivate valid tools
    if (validationResult.deactivatedTools && validationResult.deactivatedTools.length > 0) {
      const deactivateSet = new Set(validationResult.deactivatedTools);
      const newActiveTools = activeTools.filter(tool => !deactivateSet.has(tool));
      activeTools.length = 0;
      activeTools.push(...newActiveTools);
    }

    // Update params.activeTools to preserve changes during error retries
    params.activeTools = activeTools;

    // Build status message
    const statusParts: string[] = [];
    if (input.tools && input.tools.length > 0) {
      const toolNames = input.tools.map(tool => `\`${tool}\``);
      statusParts.push(`Activating ${joinWithConjunction(toolNames, 'and')}`);
    }
    if (input.deactivate && input.deactivate.length > 0) {
      const toolNames = input.deactivate.map(tool => `\`${tool}\``);
      statusParts.push(`Deactivating ${joinWithConjunction(toolNames, 'and')}`);
    }
    const statusMessage = statusParts.length > 0 ? statusParts.join('. ') + '.' : '';

    if (statusMessage) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${statusMessage}*`,
        agent,
        command: 'activate-tools',
        includeHistory: false,
        lang,
        handlerId,
        step: params.invocationCount,
      });
    }

    // Build error text for invalid tools
    const errorParts: string[] = [];
    if (validationResult.invalidTools) {
      errorParts.push(
        t('activateTools.invalidTools', {
          tools: joinWithConjunction(validationResult.invalidTools, 'and'),
        })
      );
    }
    if (validationResult.invalidDeactivateTools) {
      errorParts.push(
        t('activateTools.invalidDeactivateTools', {
          tools: joinWithConjunction(validationResult.invalidDeactivateTools, 'and'),
        })
      );
    }

    // Serialize the tool invocation with result message
    await this.renderer.serializeToolInvocation({
      path: title,
      agent,
      command: 'activate-tools',
      handlerId,
      step: params.invocationCount,
      ...(errorParts.length > 0 && {
        text: `*${errorParts.join(' ')}*`,
      }),
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: removeUndefined(validationResult),
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
