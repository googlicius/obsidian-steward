import { AgentResult, IntentResultStatus } from '../../types';
import { ToolName, ToolRegistry } from '../../ToolRegistry';
import {
  execute as executeActivateTools,
  ActivateToolsResult,
  ActivateToolsArgs,
} from '../../tools/activateTools';
import { ToolCallPart } from '../../tools/types';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { removeUndefined } from 'src/utils/removeUndefined';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';

const { getTranslation } = getBundledInternal('i18n');

/**
 * Handles the ACTIVATE tool logic shared across agents
 */
export class ActivateToolHandler {
  constructor(private readonly renderer: ConversationRenderer) {}

  /**
   * Add companion tools for any active tool that declares them in {@link TOOL_DEFINITIONS}.
   */
  private addCompanionTools(activeTools: ToolName[]): void {
    const expanded = ToolRegistry.expandWithCompanionTools(activeTools);
    activeTools.length = 0;
    activeTools.push(...expanded);
  }

  /**
   * Process an ACTIVATE tool call
   */
  public async handle(
    ctx: HandlerInvocationContext,
    options: {
      toolCall: ToolCallPart<ActivateToolsArgs>;
      activeTools: ToolName[];
      availableTools: Record<string, unknown>;
      agent: string;
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = ctx.agentHandlerParams;
    const { toolCall, activeTools, availableTools, agent } = options;
    const t = getTranslation(lang);

    // Validate and process tools
    const validationResult: ActivateToolsResult = await executeActivateTools(
      toolCall.input,
      availableTools,
      activeTools
    );

    // Activate valid tools
    if (validationResult.activatedTools && validationResult.activatedTools.length > 0) {
      activeTools.push(...(validationResult.activatedTools as ToolName[]));
    }

    // Auto-activate companion tools
    this.addCompanionTools(activeTools);

    // Deactivate valid tools
    if (validationResult.deactivatedTools && validationResult.deactivatedTools.length > 0) {
      const deactivateSet = new Set(validationResult.deactivatedTools);
      const newActiveTools = activeTools.filter(tool => !deactivateSet.has(tool as string));
      activeTools.length = 0;
      activeTools.push(...newActiveTools);
    }

    // Update params.activeTools to preserve changes during error retries
    ctx.agentHandlerParams.activeTools = activeTools;

    // Save activeTools to frontmatter immediately after activation/deactivation
    // Save whenever there's a change (activation or deactivation), even if array becomes empty
    const hasActivation =
      (validationResult.activatedTools && validationResult.activatedTools.length > 0) ||
      (validationResult.deactivatedTools && validationResult.deactivatedTools.length > 0);
    if (hasActivation) {
      await this.renderer.updateConversationFrontmatter(title, [
        {
          name: 'tools',
          value: activeTools,
        },
      ]);
    }

    // Build status message
    const statusParts: string[] = [];
    if (toolCall.input.tools && toolCall.input.tools.length > 0) {
      const toolNames = toolCall.input.tools.map(tool => `\`${tool}\``);
      statusParts.push(`Activating ${joinWithConjunction(toolNames, 'and')}`);
    }
    if (toolCall.input.deactivate && toolCall.input.deactivate.length > 0) {
      const toolNames = toolCall.input.deactivate.map(tool => `\`${tool}\``);
      statusParts.push(`Deactivating ${joinWithConjunction(toolNames, 'and')}`);
    }
    const statusMessage = statusParts.length > 0 ? statusParts.join('. ') + '.' : '';

    if (validationResult.activatedTools && validationResult.activatedTools.length > 0) {
      const instructionsPath =
        ctx.agent.plugin.toolInstructionService.getToolInstructionsRelativePath();
      const agentPath = ctx.agent.plugin.toolInstructionService.getAgentRelativePath();
      const memoryHint = `To add or change additional guidelines for tools, edit ${instructionsPath} when needed (see ${agentPath} for how to update it).`;
      validationResult.message = `${validationResult.message} ${memoryHint}`;
    }

    if (statusMessage) {
      await ctx.updateConversationNote({
        newContent: `*${statusMessage}*`,
        agent,
        command: 'activate-tools',
        includeHistory: false,
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

    const resolvedHandlerId = handlerId ?? ctx.handlerId;

    // Serialize the tool invocation with result message
    await this.renderer.serializeToolInvocation({
      path: title,
      agent,
      command: 'activate-tools',
      handlerId: resolvedHandlerId,
      step: ctx.step,
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
