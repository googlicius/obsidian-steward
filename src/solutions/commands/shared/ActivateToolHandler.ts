import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../types';
import { ToolName } from '../ToolRegistry';
import { execute as executeActivateTools, ActivateToolsResult } from '../tools/activateTools';
import { ToolInvocation } from '../tools/types';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getTranslation } from 'src/i18n';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';

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
      toolCall: ToolInvocation<unknown>;
      activeTools: ToolName[];
      availableTools: Record<string, unknown>;
      agent: string;
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall, activeTools, availableTools, agent } = options;
    const { tools: requestedTools } = toolCall.args as { tools: ToolName[] };
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('ActivateToolHandler.handle invoked without handlerId');
    }

    // Validate that requested tools exist in the available tool set
    const validationResult: ActivateToolsResult = await executeActivateTools(
      toolCall.args as { tools: ToolName[] },
      availableTools
    );

    // Only activate valid tools
    if (validationResult.activatedTools && validationResult.activatedTools.length > 0) {
      activeTools.push(...validationResult.activatedTools);
      // Update params.activeTools to preserve changes during error retries
      params.activeTools = activeTools;
    }

    const toolNamesWithBackticks = requestedTools.map(tool => `\`${tool}\``);
    const toolNamesJoined = joinWithConjunction(toolNamesWithBackticks, 'and');
    await this.renderer.updateConversationNote({
      path: title,
      newContent: `*Activating ${toolNamesJoined}.*`,
      agent,
      command: 'activate-tools',
      includeHistory: false,
      lang,
      handlerId,
      step: params.invocationCount,
    });

    // Serialize the tool invocation with result message
    await this.renderer.serializeToolInvocation({
      path: title,
      agent,
      command: 'activate-tools',
      handlerId,
      step: params.invocationCount,
      ...(validationResult.invalidTools && {
        text: `*${t('activateTools.invalidTools', { tools: joinWithConjunction(validationResult.invalidTools, 'and') })}*`,
      }),
      toolInvocations: [
        {
          ...toolCall,
          result: validationResult,
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
