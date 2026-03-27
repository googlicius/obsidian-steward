import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { getTranslation } from 'src/i18n';
import type { AgentHandlerContext } from '../AgentHandlerContext';

const switchAgentCapacitySchema = z.object({});

export type SwitchAgentCapacityArgs = z.infer<typeof switchAgentCapacitySchema>;

export class SwitchAgentCapacity {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getSwitchAgentCapacityTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: switchAgentCapacitySchema,
    });
  }

  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<SwitchAgentCapacityArgs>;
      continueFromNextTool?: () => Promise<AgentResult>;
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall, continueFromNextTool } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('SwitchAgentCapacity.handle invoked without handlerId');
    }

    const confirmationMessage = t('switchCapacity.confirm');

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: confirmationMessage,
      command: 'switch-agent-capacity',
      includeHistory: false,
      lang,
      handlerId,
      step: params.invocationCount,
    });

    return {
      status: IntentResultStatus.NEEDS_CONFIRMATION,
      confirmationMessage,
      toolCall,
      onConfirmation: async () => {
        await this.applySwitch({
          title,
          lang,
          handlerId,
          step: params.invocationCount,
          toolCall,
        });
        // Full tool surface: frontmatter `allowed_tools` is cleared; drop intent restriction so
        // resolution uses all tools (switch_agent_capacity is omitted from the full surface).
        params.intent.tools = undefined;
        if (!continueFromNextTool) {
          return {
            status: IntentResultStatus.SUCCESS,
          };
        }
        return continueFromNextTool();
      },
      onRejection: async () => {
        const rejectedMessage = t('switchCapacity.cancelled');

        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: rejectedMessage,
          command: 'switch-agent-capacity',
          includeHistory: false,
          lang,
          handlerId,
          step: params.invocationCount,
        });

        await this.agent.serializeInvocation({
          title,
          command: 'switch-agent-capacity',
          handlerId,
          step: params.invocationCount,
          toolCall,
          result: {
            type: 'text',
            value: rejectedMessage,
          },
        });

        if (!continueFromNextTool) {
          return {
            status: IntentResultStatus.SUCCESS,
          };
        }
        return continueFromNextTool();
      },
    };
  }

  private async applySwitch(params: {
    title: string;
    lang?: string | null;
    handlerId: string;
    step?: number;
    toolCall: ToolCallPart<SwitchAgentCapacityArgs>;
  }): Promise<void> {
    const { title, lang, handlerId, step, toolCall } = params;
    const t = getTranslation(lang);

    await this.agent.renderer.updateConversationFrontmatter(title, [
      { name: 'allowed_tools', delete: true },
    ]);

    const enabledMessage = t('switchCapacity.enabled');

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: enabledMessage,
      command: 'switch-agent-capacity',
      includeHistory: false,
      lang,
      handlerId,
      step,
    });

    await this.agent.serializeInvocation({
      title,
      command: 'switch-agent-capacity',
      handlerId,
      step,
      toolCall,
      result: {
        type: 'text',
        value: enabledMessage,
      },
    });
  }
}
