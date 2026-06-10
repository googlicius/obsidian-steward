import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { normalizePath, TFile, TFolder } from 'obsidian';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ArtifactType } from 'src/solutions/artifact';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';

const { getTranslation } = getBundledInternal('i18n');

const MAX_FILES_TO_SHOW = 100;
const LIST_ITEM_TYPES = ['both', 'files', 'folders'] as const;
type ListItemType = (typeof LIST_ITEM_TYPES)[number];

export const listToolArgMapSchema = z.object(
  {
    folderPath: z
      .string()
      .optional()
      .transform(val => {
        if (!val?.trim()) {
          return undefined;
        }

        return normalizePath(val.trim());
      })
      .describe(
        'Optional folder path to list files from. Specify / to list from the root. If not provided, filePattern is required.'
      ),
    filePattern: z
      .string()
      .optional()
      .describe(
        'Optional RegExp pattern to filter item names. Required when folderPath is not provided.'
      ),
    itemType: z
      .enum(LIST_ITEM_TYPES)
      .optional()
      .default('both')
      .describe(
        'Optional result type filter: both for files and folders, files for files only, folders for folders only.'
      ),
    lang: z.string().nullable().optional().describe(userLanguagePrompt.content),
  },
  {
    description: `List direct files and subfolders in a specific folder (non-recursive).`,
  }
);

export const listToolSchema = listToolArgMapSchema.superRefine((args, ctx) => {
  const hasFolderPath = Boolean(args.folderPath?.trim());
  const hasFilePattern = Boolean(args.filePattern?.trim());

  if (hasFolderPath || hasFilePattern) {
    return;
  }

  const message = 'Either folderPath or filePattern must be provided.';

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path: ['folderPath'],
  });

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path: ['filePattern'],
  });
});

export type ListToolArgs = z.infer<typeof listToolSchema>;

type ListedItem = {
  path: string;
  isFolder: boolean;
  size?: number;
};

type ListToolResult = {
  response: string;
  files: string[];
  errors?: string[];
};

export class VaultList {
  constructor(private readonly agent: AgentHandlerContext) {}

  public extractPathsForGuardrails(input: ListToolArgs): string[] {
    const folderPath = input.folderPath ?? '';
    return [normalizePath(folderPath || '/')];
  }

  public static async getListTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: listToolSchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<ListToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const folderPath = toolCall.input.folderPath || '/';

    const result = await this.executeListTool(toolCall.input, ctx.lang, ctx.title);

    const t = getTranslation(ctx.lang);
    await ctx.updateConversationNote({
      newContent: `*${t('list.listInFolder', { count: result.files.length, folder: folderPath })}*`,
      command: 'vault_list',
      includeHistory: false,
    });

    const hasMoreFiles = result.files.length > MAX_FILES_TO_SHOW;
    const artifactId = `list_${Date.now()}`;

    await this.agent.plugin.artifactManagerV2.withTitle(ctx.title).storeArtifact({
      artifact: {
        artifactType: ArtifactType.LIST_RESULTS,
        paths: result.files,
        id: artifactId,
        createdAt: Date.now(),
      },
    });

    // Build result string: response text + artifact message if files reached max count
    let resultText = result.response;
    if (hasMoreFiles) {
      resultText += `\n\n${t('list.fullListInArtifactUseFilePattern', { artifactId })}`;
    }

    await ctx.serializeInvocation({
      command: 'vault_list',
      toolCall,
      result: {
        type: 'text',
        value: resultText,
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async executeListTool(
    input: ListToolArgs,
    lang: string | null | undefined,
    title?: string
  ): Promise<ListToolResult> {
    const folderPath = input.folderPath || '/';
    const filePattern = input.filePattern?.trim();
    const itemType = input.itemType ?? 'both';
    const t = getTranslation(lang);
    const errors: string[] = [];

    // Validate regex pattern if provided
    if (filePattern) {
      try {
        new RegExp(filePattern, 'i');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorMsg = `Invalid RegExp pattern: ${filePattern}. ${errorMessage}`;
        errors.push(errorMsg);
        return {
          response: `Error: ${errorMsg}`,
          files: [],
          errors,
        };
      }
    }

    // Get folder using Obsidian API
    const folder = this.agent.app.vault.getFolderByPath(folderPath);
    if (!folder) {
      const errorMessage = `Folder not found: ${folderPath}`;
      errors.push(errorMessage);
      const messageKey = folderPath ? 'list.noItemsFoundInFolder' : 'list.noItemsFound';
      return {
        response: t(messageKey, { folder: folderPath }),
        files: [],
        errors,
      };
    }

    // Resolve current conversation path if title is provided
    const currentConversationPath = title
      ? `${this.agent.plugin.settings.stewardFolder}/Conversations/${title}.md`
      : undefined;

    // Collect direct files and subfolders only (non-recursive)
    const listedItems: ListedItem[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) && !(child instanceof TFolder)) {
        continue;
      }

      if (!this.shouldIncludeItemType({ child, itemType })) {
        continue;
      }

      if (filePattern && !this.matchesPattern(child.name, filePattern)) {
        continue;
      }

      if (child instanceof TFolder) {
        listedItems.push({
          path: `${child.path}/`,
          isFolder: true,
        });
        continue;
      }

      listedItems.push({
        path: child.path,
        isFolder: false,
        size: child.stat?.size,
      });
    }

    if (listedItems.length === 0) {
      const messageKey = folderPath ? 'list.noItemsFoundInFolder' : 'list.noItemsFound';
      return {
        response: t(messageKey, { folder: folderPath }),
        files: [],
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    const itemLines: string[] = [];
    for (let index = 0; index < listedItems.length && index < MAX_FILES_TO_SHOW; index += 1) {
      const item = listedItems[index];
      const line = item.isFolder
        ? item.path
        : t('list.fileWithSize', { path: item.path, size: item.size ?? 0 });
      itemLines.push(`- ${line}`);
    }

    const moreCount =
      listedItems.length > MAX_FILES_TO_SHOW ? listedItems.length - MAX_FILES_TO_SHOW : 0;

    const headerKey = folderPath ? 'list.foundItemsInFolder' : 'list.foundItems';
    let response = `${t(headerKey, {
      count: listedItems.length,
      folder: folderPath,
    })}:\n\n${itemLines.join('\n')}`;

    if (moreCount > 0) {
      response += `\n\n${t('list.moreItems', { count: moreCount })}`;
    }

    if (currentConversationPath) {
      response += `\n\nCurrent conversation file: ${currentConversationPath}`;
    }

    return {
      response,
      files: listedItems.map(item => item.path),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Check if a filename matches the given RegExp pattern.
   * The pattern is treated as a pure RegExp string.
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(filename);
    } catch {
      // If regex is invalid, return false
      return false;
    }
  }

  private shouldIncludeItemType({
    child,
    itemType,
  }: {
    child: TFile | TFolder;
    itemType: ListItemType;
  }): boolean {
    if (itemType === 'both') {
      return true;
    }

    if (itemType === 'files') {
      return child instanceof TFile;
    }

    return child instanceof TFolder;
  }
}
