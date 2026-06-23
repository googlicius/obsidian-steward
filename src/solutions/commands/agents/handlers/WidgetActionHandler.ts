import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../toolNames';

const { getTranslation } = getBundledInternal('i18n');

export const widgetActionSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  comment: z.string().optional(),
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

    if (!projectPath) {
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

    const session = await this.agent.plugin.widgetService.stateService.readSession(projectPath);
    if (!session || session.phase !== 'thinking') {
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

    const actorId = session.actor;

    const definition =
      await this.agent.plugin.widgetService.definitionService.getWidgetDefinition(projectPath);

    const allowedActions = definition.agents[actorId]?.actions;
    if (!allowedActions?.includes(toolCall.input.action)) {
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

    const result = await this.agent.plugin.widgetService.applyAction({
      projectPath,
      action: toolCall.input.action,
      actionParams: toolCall.input.params ?? {},
    });

    if (result.ok) {
      const endTurn = this.agent.plugin.widgetService.orchestrator.resolveActionEndTurn({
        definition,
        actionName: toolCall.input.action,
        result,
      });

      await this.agent.plugin.widgetService.sessionService.recordMoveAndMaybeAdvance({
        projectPath,
        actorId,
        action: toolCall.input.action,
        params: toolCall.input.params ?? undefined,
        comment: toolCall.input.comment?.trim() || undefined,
        turnOrder: definition.actors?.turnOrder ?? [],
        endTurn,
      });

      const t = getTranslation(ctx.lang);
      const trimmedComment = toolCall.input.comment?.trim();
      const commentSuffix = trimmedComment ? ` — ${trimmedComment}` : '';
      await ctx.updateConversationNote({
        newContent: t('widget.sessionMove', {
          actor: actorId,
          action: toolCall.input.action,
          comment: commentSuffix,
        }),
        role: 'Steward',
        includeHistory: false,
      });

      const message = endTurn
        ? 'Move accepted. Your turn is complete — do not take any further action.'
        : 'Action accepted. You may take another action before ending your turn.';

      await ctx.serializeInvocation({
        command: ToolName.WIDGET_ACTION,
        toolCall,
        result: {
          type: 'json',
          value: {
            ok: true,
            endTurn,
            message,
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
