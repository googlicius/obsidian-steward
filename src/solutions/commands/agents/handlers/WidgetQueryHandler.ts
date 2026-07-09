import { z } from 'zod/v3';
import { JSONValue } from 'ai';
import { getBundledLib } from 'src/utils/bundledLibs';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../toolNames';
import { DEFAULT_WIDGET_QUERY_NAME } from 'src/services/WidgetService/types';

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

    if (!projectPath) {
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

    const session = await this.agent.plugin.widgetService.stateService.readSession(projectPath);

    const queryName = toolCall.input.query ?? DEFAULT_WIDGET_QUERY_NAME;

    const result = await this.agent.plugin.widgetService.dispatchQuery({
      projectPath,
      query: queryName,
      queryParams: toolCall.input.params ?? {},
    });

    if (result.ok) {
      const t = getTranslation(ctx.lang);
      await ctx.updateConversationNote({
        newContent: t('widget.sessionQuery', {
          actor: session?.actor ?? 'Steward',
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
