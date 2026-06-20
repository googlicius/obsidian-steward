import { z } from 'zod/v3';
import { JSONValue } from 'ai';
import { getBundledLib } from 'src/utils/bundledLibs';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../toolNames';
import {
  DEFAULT_WIDGET_QUERY_NAME,
  resolveAgentAllowedQueries,
} from 'src/services/WidgetService/types';

const { getTranslation } = getBundledInternal('i18n');

export const widgetQuerySchema = z.object({
  query: z.string().min(1).optional().default(DEFAULT_WIDGET_QUERY_NAME),
  params: z.record(z.unknown()).optional(),
});

export type WidgetQueryArgs = z.infer<typeof widgetQuerySchema>;

export class WidgetQueryHandler {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getWidgetQueryTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: widgetQuerySchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<WidgetQueryArgs> }
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
        command: ToolName.WIDGET_QUERY,
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
        command: ToolName.WIDGET_QUERY,
        toolCall,
        result: {
          type: 'error-text',
          value: `unknown_widget_actor:${actorId}`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const queryName = toolCall.input.query ?? DEFAULT_WIDGET_QUERY_NAME;
    const allowedQueries = resolveAgentAllowedQueries(agentBlock);
    if (!allowedQueries.includes(queryName)) {
      await ctx.serializeInvocation({
        command: ToolName.WIDGET_QUERY,
        toolCall,
        result: {
          type: 'error-text',
          value: `query_not_allowed:${queryName}`,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    const result = await this.agent.plugin.widgetService.dispatchQuery({
      projectPath,
      query: queryName,
      queryParams: toolCall.input.params ?? {},
    });

    if (result.ok) {
      const t = getTranslation(ctx.lang);
      await ctx.updateConversationNote({
        newContent: t('widget.sessionQuery', {
          actor: actorId,
          query: queryName,
        }),
        role: 'Steward',
        includeHistory: false,
      });

      await ctx.serializeInvocation({
        command: ToolName.WIDGET_QUERY,
        toolCall,
        result: {
          type: 'json',
          value: JSON.parse(JSON.stringify(result.data ?? null)) as JSONValue,
        },
      });
      return { status: IntentResultStatus.SUCCESS };
    }

    await ctx.serializeInvocation({
      command: ToolName.WIDGET_QUERY,
      toolCall,
      result: {
        type: 'error-text',
        value: result.error ?? 'widget_query_failed',
      },
    });
    return { status: IntentResultStatus.SUCCESS };
  }
}
