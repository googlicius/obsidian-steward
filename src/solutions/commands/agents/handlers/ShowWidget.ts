import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ArtifactType } from 'src/solutions/artifact/types';
import { logger } from 'src/utils/logger';
import { ToolName } from '../../toolNames';

export type ObsidianUiTheme = 'Light' | 'Dark';

export interface ObsidianUiThemeContext {
  theme: ObsidianUiTheme;
  background: string;
  foreground: string;
}

function getObsidianUiThemeContext(): ObsidianUiThemeContext {
  const isDark = document.body.classList.contains('theme-dark');
  const theme: ObsidianUiTheme = isDark ? 'Dark' : 'Light';
  const style = window.getComputedStyle(document.body);
  const background =
    style.getPropertyValue('--background-primary').trim() || (isDark ? '#1e1e1e' : '#ffffff');
  const foreground =
    style.getPropertyValue('--text-normal').trim() || (isDark ? '#dcddde' : '#222222');

  return { theme, background, foreground };
}

export function getShowWidgetThemeGuideline(): string {
  const { theme, background, foreground } = getObsidianUiThemeContext();
  return `Current Obsidian UI theme: ${theme}. Use base colors that match this theme — background: ${background}, text: ${foreground}.`;
}

export const WIDGET_TYPES = ['html', 'svg'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const showWidgetSchema = z.object({
  code: z
    .string()
    .min(1, 'Code must be a non-empty string')
    .describe(
      'Self-contained content for the widget. For "html": full HTML with inline <style> and <script>. For "svg": raw SVG markup.'
    ),
  type: z.enum(WIDGET_TYPES).describe('The content format of the widget.'),
});

export type ShowWidgetArgs = z.infer<typeof showWidgetSchema>;

export function getWidgetFenceLanguage(type: WidgetType): string {
  return `stw-widget-${type}`;
}

export function buildWidgetFence(params: { type: WidgetType; code: string }): string {
  const language = getWidgetFenceLanguage(params.type);
  return `\`\`\`${language}\n${params.code}\n\`\`\``;
}

export class ShowWidget {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getShowWidgetTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: showWidgetSchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<ShowWidgetArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const { title } = ctx.agentHandlerParams;

    try {
      const contentMessageId = await ctx.updateConversationNote({
        newContent: `\n${buildWidgetFence({
          type: toolCall.input.type,
          code: toolCall.input.code,
        })}`,
        command: 'show_widget',
        includeHistory: false,
      });

      if (!contentMessageId) {
        throw new Error('Failed to store widget in conversation note');
      }

      const artifactId = await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.WIDGET,
          contentMessageId,
          type: toolCall.input.type,
          code: '',
        },
      });

      if (!artifactId) {
        throw new Error('Failed to store widget artifact');
      }

      await ctx.serializeInvocation({
        command: 'show_widget',
        toolCall: this.buildSerializedWidgetToolCall(toolCall),
        result: {
          type: 'json',
          value: {
            success: true,
            type: toolCall.input.type,
            artifactId,
            message: this.buildWidgetSuccessMessage(artifactId),
          },
        },
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error rendering widget:', error);

      await ctx.updateConversationNote({
        newContent: `*Error rendering widget: ${error instanceof Error ? error.message : String(error)}*`,
        role: 'Steward',
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'show_widget',
        handlerId: ctx.handlerId,
        step: ctx.step,
        toolInvocations: [
          {
            ...this.buildSerializedWidgetToolCall(toolCall),
            type: 'tool-result',
            output: {
              type: 'error-text',
              value: error instanceof Error ? error.message : String(error),
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private buildSerializedWidgetToolCall(
    toolCall: ToolCallPart<ShowWidgetArgs>
  ): ToolCallPart<ShowWidgetArgs> {
    return {
      ...toolCall,
      input: {
        type: toolCall.input.type,
        code: '[OMITTED]',
      },
    };
  }

  private buildWidgetSuccessMessage(artifactId: string): string {
    return `The code is omitted and the widget is rendered successfully. To retrieve the full code, call ${ToolName.GET_ARTIFACT_BY_ID} with the ID: ${artifactId} to retrieve it.`;
  }
}
