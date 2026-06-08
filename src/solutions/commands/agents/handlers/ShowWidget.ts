import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ArtifactType } from 'src/solutions/artifact/types';
import { logger } from 'src/utils/logger';
import { ToolName } from '../../toolNames';
import { normalizePath } from 'obsidian';
import { JSONValue } from 'ai';

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
  return [
    `Current Obsidian UI theme: ${theme}.`,
    'Set html and body background to transparent, so the widget blends with Obsidian when the theme changes.',
    `Use these as base colors for widget elements (cards, panels, buttons, borders): background ${background}, text ${foreground}.`,
  ].join(' ');
}

export const WIDGET_TYPES = ['html', 'svg'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

const widgetProjectFileSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Relative path in the project (e.g. index.html, style.css, main.js).'),
  content: z.string().describe('Full file contents for that path.'),
});

export const showWidgetSchema = z
  .object({
    type: z.enum(WIDGET_TYPES).describe('The content format of the widget.'),
    widgetName: z
      .string()
      .min(1)
      .describe(
        'Natural-language name for the widget. Used to build widgetId and the vault folder name under Steward/Widgets/ for project mode.'
      ),
    code: z
      .string()
      .optional()
      .describe(
        'Single-blob widget content. For "html": full HTML with inline <style> and <script>. For "svg": raw SVG markup.'
      ),
    files: z
      .array(widgetProjectFileSchema)
      .optional()
      .describe(
        'Project mode (html only): split markup into separate files instead of one HTML blob — e.g. index.html, style.css, main.js. Reference local files from index.html via <link href="style.css"> and <script src="main.js">; they are bundled into one document at render time. Use this for updatable widgets; omit code when files is set.'
      ),
    entry: z
      .string()
      .optional()
      .describe(
        'Entry HTML file name in files (project mode). Must match a files[].name. Defaults to index.html.'
      ),
    assets: z
      .array(
        z
          .string()
          .min(1)
          .describe('File path as asset to use in HTML where paths are prefixed with `asset:`')
      )
      .optional()
      .describe(
        [
          'Vault files to bundle as base64 at render time. Reference each path with the asset: prefix in HTML, CSS, or JS (e.g. src="asset:Images/photo.png"). Manifest defaults to maxAssetSize 5MB; edit Widget.md to raise it for larger files.',
          'IMPORTANT: Assets is required if any path in project files is prefixed with `asset:`',
        ].join('\n')
      ),
  })
  .superRefine((data, ctx) => {
    const isProject = data.files !== undefined && data.files.length > 0;

    if (isProject) {
      if (data.type !== 'html') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Multi-file widget projects require type "html".',
          path: ['type'],
        });
      }
      const entry = data.entry ?? 'index.html';
      const projectFiles = data.files ?? [];
      const hasEntry = projectFiles.some(file => file.name === entry);
      if (!hasEntry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Entry file "${entry}" must be present in files (as a files[].name).`,
          path: ['files'],
        });
      }
      return;
    }

    if (!data.code || data.code.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either code or files must be provided.',
        path: ['code'],
      });
    }
  });

export type ShowWidgetArgs = z.infer<typeof showWidgetSchema>;
export type WidgetProjectFile = z.infer<typeof widgetProjectFileSchema>;

export function isWidgetProjectInput(input: ShowWidgetArgs): boolean {
  return input.files !== undefined && input.files.length > 0;
}

/** Converts tool input files[] into a path → content map for vault writes. */
export function projectFilesToRecord(files: WidgetProjectFile[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < files.length; i++) {
    record[files[i].name] = files[i].content;
  }
  return record;
}

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
      if (isWidgetProjectInput(toolCall.input)) {
        return await this.handleProjectWidget(ctx, toolCall);
      }

      return await this.handleCodeWidget(ctx, toolCall);
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
            ...toolCall,
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

  private async handleCodeWidget(
    ctx: HandlerInvocationContext,
    toolCall: ToolCallPart<ShowWidgetArgs>
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const rawCode = toolCall.input.code ?? '';
    const code = this.agent.plugin.widgetService.inlineAssetsInHtml({
      html: rawCode,
      assets: toolCall.input.assets,
    });

    const missingAssets = this.agent.plugin.widgetService.findMissingAssets({
      content: rawCode,
      declaredAssets: toolCall.input.assets,
    });

    const contentMessageId = await ctx.updateConversationNote({
      newContent: `\n${buildWidgetFence({
        type: toolCall.input.type,
        code,
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
      toolCall,
      result: {
        type: 'json',
        value: {
          success: true,
          type: toolCall.input.type,
          artifactId,
          ...(missingAssets.length > 0 ? { missingAssets } : {}),
          message: this.buildCodeWidgetResultMessage({ missingAssets }),
        },
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async handleProjectWidget(
    ctx: HandlerInvocationContext,
    toolCall: ToolCallPart<ShowWidgetArgs>
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const widgetService = this.agent.plugin.widgetService;
    const widgetId = widgetService.buildWidgetId(toolCall.input.widgetName);
    const projectFiles = toolCall.input.files ?? [];
    const files = projectFilesToRecord(projectFiles);
    const missingAssets = widgetService.findMissingAssets({
      content: projectFiles.map(file => file.content),
      declaredAssets: toolCall.input.assets,
    });
    const { projectPath } = await widgetService.createProject({
      widgetId,
      widgetName: toolCall.input.widgetName,
      files,
      entry: toolCall.input.entry,
      assets: toolCall.input.assets,
    });

    const jsFilePaths = Object.keys(files)
      .filter(name => widgetService.jsValidator.isJsFilePath(name))
      .map(name => normalizePath(`${projectPath}/${name}`));
    const jsErrors = await widgetService.validateWrittenJsFiles(jsFilePaths);
    const lintError =
      jsErrors.length > 0 ? widgetService.jsValidator.formatErrors(jsErrors) : undefined;

    const fence = widgetService.buildProjectFence({
      widgetId,
      widgetName: toolCall.input.widgetName,
      lang: ctx.lang,
    });

    const contentMessageId = await ctx.updateConversationNote({
      newContent: `\n${fence}`,
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
        type: 'html',
        code: '',
      },
    });

    if (!artifactId) {
      throw new Error('Failed to store widget artifact');
    }

    const message = this.buildProjectWidgetResultMessage({
      widgetId,
      projectPath,
      missingAssets,
      lintError,
    });
    const type = lintError ? 'error-json' : 'json';
    const value: JSONValue = {
      type: 'html',
      widgetId,
      projectPath,
      message,
    };

    if (missingAssets.length > 0) {
      value.missingAssets = missingAssets;
    }

    if (lintError) {
      value.lintError = lintError;
    } else {
      value.success = true;
    }

    await ctx.serializeInvocation({
      command: 'show_widget',
      toolCall,
      result: { type, value },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private buildCodeWidgetResultMessage(params: { missingAssets: string[] }): string {
    let message = 'The widget is rendered successfully.';

    if (params.missingAssets.length > 0) {
      message += ` Missing assets: ${params.missingAssets.join(', ')}. These vault paths are referenced with the asset: prefix in HTML but were not included in the assets parameter. Call ${ToolName.SHOW_WIDGET} again with these paths added to assets.`;
    }

    return message;
  }

  private buildProjectWidgetResultMessage(params: {
    widgetId: string;
    projectPath: string;
    missingAssets: string[];
    lintError?: string;
  }): string {
    let message =
      params.lintError !== undefined
        ? `Widget project created at ${params.projectPath} but JavaScript has syntax errors. Fix them with ${ToolName.EDIT} on files in that folder.`
        : `The widget is rendered successfully. Widget ID: ${params.widgetId}. Project folder: ${params.projectPath}.`;

    message += `\nIf the user ask for update, use ${ToolName.EDIT} and ${ToolName.CONTENT_READING} on the projectPath returned in the tool result.`;
    message += `\nDo not call ${ToolName.SHOW_WIDGET} again for updates.`;

    if (params.missingAssets.length > 0) {
      const definitionPath = `${params.projectPath}/Widget.md`;
      message += `\nMissing assets: ${params.missingAssets.join(', ')}. These vault paths are referenced with the asset: prefix in project files but are not listed in the Widget.md manifest assets. Use ${ToolName.EDIT} to add them to the "assets" array in the \`name: manifest\` YAML block in ${definitionPath}. The widget refreshes automatically when Widget.md is saved.`;
    }

    return message;
  }
}
