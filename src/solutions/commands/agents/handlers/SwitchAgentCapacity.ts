import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';

const { getTranslation } = getBundledInternal('i18n');

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
    ctx: HandlerInvocationContext,
    options: {
      toolCall: ToolCallPart<SwitchAgentCapacityArgs>;
      continueFromNextTool?: () => Promise<AgentResult>;
    }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const { toolCall, continueFromNextTool } = options;
    const t = getTranslation(ctx.lang);

    const confirmationMessage = t('switchCapacity.confirm');

    await ctx.updateConversationNote({
      newContent: confirmationMessage,
      command: 'switch-agent-capacity',
      includeHistory: false,
    });

    return {
      status: IntentResultStatus.NEEDS_CONFIRMATION,
      confirmationMessage,
      toolCall,
      onConfirmation: async () => {
        await this.applySwitch(ctx, toolCall);
        // Full tool surface: frontmatter `allowed_tools` is cleared; drop intent restriction so
        // resolution uses all tools (switch_agent_capacity is omitted from the full surface).
        ctx.agentHandlerParams.intent.tools = undefined;
        if (!continueFromNextTool) {
          return {
            status: IntentResultStatus.SUCCESS,
          };
        }
        return continueFromNextTool();
      },
      onRejection: async () => {
        const rejectedMessage = t('switchCapacity.cancelled');

        await ctx.updateConversationNote({
          newContent: rejectedMessage,
          command: 'switch-agent-capacity',
          includeHistory: false,
        });

        await ctx.serializeInvocation({
          command: 'switch-agent-capacity',
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

  private async applySwitch(
    ctx: HandlerInvocationContext,
    toolCall: ToolCallPart<SwitchAgentCapacityArgs>
  ): Promise<void> {
    const { title } = ctx.agentHandlerParams;
    const t = getTranslation(ctx.lang);

    await this.agent.renderer.updateConversationFrontmatter(title, [
      { name: 'allowed_tools', delete: true },
    ]);

    const enabledMessage = t('switchCapacity.enabled');

    await ctx.updateConversationNote({
      newContent: enabledMessage,
      command: 'switch-agent-capacity',
      includeHistory: false,
    });

    await ctx.serializeInvocation({
      command: 'switch-agent-capacity',
      toolCall,
      result: {
        type: 'text',
        value: enabledMessage,
      },
    });
  }
}
