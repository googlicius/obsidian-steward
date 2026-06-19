import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../toolNames';

export const widgetActionSchema = z
  .object({
    action: z.string().min(1),
    params: z.record(z.unknown()).optional(),
    comment: z.string().optional(),
    with_json: z.boolean().optional(),
    with_presentation: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const includeJson = value.with_json !== false;
    const includePresentation = value.with_presentation !== false;
    if (!includeJson && !includePresentation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'with_json and with_presentation cannot both be false',
        path: ['with_json'],
      });
    }
  });

export type WidgetActionArgs = z.infer<typeof widgetActionSchema>;

export class WidgetActionHandler {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getWidgetActionTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: widgetActionSchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<WidgetActionArgs> }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const { toolCall } = options;

    const projectPath = await this.agent.renderer.getConversationProperty<string>(
      title,
      'widget_project_path'
    );
    const actorId = await this.agent.renderer.getConversationProperty<string>(
      title,
      'widget_actor_id'
    );

    if (!projectPath || !actorId) {
      await ctx.serializeInvocation({
        command: ToolName.WIDGET_ACTION,
        toolCall,
        result: {
          type: 'error-text',
          value: 'widget_session_context_missing',
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const definition =
      await this.agent.plugin.widgetService.definitionService.getWidgetDefinition(projectPath);
    const agentBlock = definition.agents[actorId];
    if (!agentBlock) {
      await ctx.serializeInvocation({
        command: ToolName.WIDGET_ACTION,
        toolCall,
        result: {
          type: 'error-text',
          value: `unknown_widget_actor:${actorId}`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    if (!agentBlock.actions.includes(toolCall.input.action)) {
      await ctx.serializeInvocation({
        command: ToolName.WIDGET_ACTION,
        toolCall,
        result: {
          type: 'error-text',
          value: `action_not_allowed:${toolCall.input.action}`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const session = await this.agent.plugin.widgetService.stateService.readSession(projectPath);
    if (!session || session.actor !== actorId) {
      await ctx.serializeInvocation({
        command: ToolName.WIDGET_ACTION,
        toolCall,
        result: {
          type: 'error-text',
          value: 'not_your_turn',
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const result = await this.agent.plugin.widgetService.applyAction({
      projectPath,
      action: toolCall.input.action,
      actionParams: toolCall.input.params ?? {},
    });

    await this.agent.plugin.widgetService.sessionService.updateTurnContextPrefs({
      projectPath,
      prefs: {
        includeJson: toolCall.input.with_json !== false,
        includePresentation: toolCall.input.with_presentation !== false,
      },
    });

    if (result.ok) {
      await this.agent.plugin.widgetService.sessionService.recordModelMoveAndAdvance({
        projectPath,
        actorId,
        action: toolCall.input.action,
        comment: toolCall.input.comment?.trim() || undefined,
        turnOrder: definition.actors?.turnOrder ?? [],
      });
    }

    if (result.ok && toolCall.input.comment?.trim()) {
      await this.agent.plugin.widgetService.sessionService.appendMoveComment({
        conversationTitle: title,
        actorId,
        action: toolCall.input.action,
        comment: toolCall.input.comment.trim(),
      });
    }

    if (result.ok) {
      await ctx.serializeInvocation({
        command: ToolName.WIDGET_ACTION,
        toolCall,
        result: {
          type: 'json',
          value: {
            ok: true,
            message: 'Move accepted. Your turn is complete — do not take any further action.',
          },
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    await ctx.serializeInvocation({
      command: ToolName.WIDGET_ACTION,
      toolCall,
      result: {
        type: 'error-json',
        value: {
          ok: false,
          error: result.error ?? 'widget_action_failed',
        },
      },
    });
    return { status: IntentResultStatus.SUCCESS };
  }
}
