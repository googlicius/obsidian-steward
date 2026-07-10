import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';

const switchModelSchema = z.object({
  model: z.string().min(1),
  reason: z.string().min(1),
});

export type SwitchModelArgs = z.infer<typeof switchModelSchema>;

export class SwitchModel {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getSwitchModelTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      description:
        "Switch to another model from this conversation's allowed model list (e.g. when the current model cannot process images).",
      inputSchema: switchModelSchema,
    });
  }

  private async resolveAllowedModels(ctx: HandlerInvocationContext): Promise<string[]> {
    const intentModels = ctx.agentHandlerParams.intent.models;
    if (intentModels && intentModels.length > 0) {
      return intentModels;
    }

    const state = await this.agent.plugin.modelFallbackService.getState(ctx.title);
    return state?.chain ?? [];
  }

  private resolveCurrentModel(ctx: HandlerInvocationContext): string | undefined {
    return ctx.agentHandlerParams.intent.model?.trim() || undefined;
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<SwitchModelArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const allowedModels = await this.resolveAllowedModels(ctx);
    const targetModel = toolCall.input.model.trim();
    const currentModel = this.resolveCurrentModel(ctx);

    if (allowedModels.length === 0) {
      await ctx.serializeInvocation({
        command: ToolName.SWITCH_MODEL,
        toolCall,
        result: {
          type: 'error-text',
          value: 'No model list is configured for this conversation.',
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    if (!allowedModels.includes(targetModel)) {
      await ctx.serializeInvocation({
        command: ToolName.SWITCH_MODEL,
        toolCall,
        result: {
          type: 'error-text',
          value: `Model "${targetModel}" is not in the allowed list: ${allowedModels.join(', ')}`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    if (currentModel === targetModel) {
      await ctx.serializeInvocation({
        command: ToolName.SWITCH_MODEL,
        toolCall,
        result: {
          type: 'error-text',
          value: `Model "${targetModel}" is already the current model.`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const switched = await this.agent.plugin.modelFallbackService.switchToModel(
      ctx.title,
      targetModel
    );
    if (!switched) {
      await ctx.serializeInvocation({
        command: ToolName.SWITCH_MODEL,
        toolCall,
        result: {
          type: 'error-text',
          value: `Failed to switch to model "${targetModel}".`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    ctx.agentHandlerParams.intent.model = targetModel;

    const fromLabel = currentModel ?? 'default';
    await ctx.serializeInvocation({
      command: ToolName.SWITCH_MODEL,
      toolCall,
      result: {
        type: 'text',
        value: `Switched from ${fromLabel} to ${targetModel}.`,
      },
    });

    return { status: IntentResultStatus.SUCCESS };
  }
}
