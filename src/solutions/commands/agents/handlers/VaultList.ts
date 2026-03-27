import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { normalizePath, TFile, TFolder } from 'obsidian';
import { getTranslation } from 'src/i18n';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ArtifactType } from 'src/solutions/artifact';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';

const MAX_FILES_TO_SHOW = 10;
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
    lang: z
      .string()
      .nullable()
      .optional()
      .describe(userLanguagePrompt.content as string),
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
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<ListToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;

    if (!params.handlerId) {
      throw new Error('VaultList.handle invoked without handlerId');
    }

    const result = await this.executeListTool(toolCall.input, params.lang);

    const hasMoreFiles = result.files.length > MAX_FILES_TO_SHOW;
    const artifactId = `list_${Date.now()}`;

    await this.agent.plugin.artifactManagerV2.withTitle(params.title).storeArtifact({
      artifact: {
        artifactType: ArtifactType.LIST_RESULTS,
        paths: result.files,
        id: artifactId,
        createdAt: Date.now(),
      },
    });

    // Build result string: response text + artifact message if files reached max count
    const t = getTranslation(params.lang);
    let resultText = result.response;
    if (hasMoreFiles) {
      resultText += `\n\n${t('list.fullListInArtifactUseFilePattern', { artifactId })}`;
    }

    await this.agent.serializeInvocation({
      command: 'vault_list',
      title: params.title,
      handlerId: params.handlerId,
      step: params.invocationCount,
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
    lang: string | null | undefined
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

    // Collect direct files and subfolders only (non-recursive)
    const listedPaths: string[] = [];
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
        listedPaths.push(`${child.path}/`);
        continue;
      }

      listedPaths.push(child.path);
    }

    if (listedPaths.length === 0) {
      const messageKey = folderPath ? 'list.noItemsFoundInFolder' : 'list.noItemsFound';
      return {
        response: t(messageKey, { folder: folderPath }),
        files: [],
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    const itemLines: string[] = [];
    for (let index = 0; index < listedPaths.length && index < MAX_FILES_TO_SHOW; index += 1) {
      itemLines.push(`- ${listedPaths[index]}`);
    }

    const moreCount =
      listedPaths.length > MAX_FILES_TO_SHOW ? listedPaths.length - MAX_FILES_TO_SHOW : 0;

    const headerKey = folderPath ? 'list.foundItemsInFolder' : 'list.foundItems';
    let response = `${t(headerKey, {
      count: listedPaths.length,
      folder: folderPath,
    })}:\n\n${itemLines.join('\n')}`;

    if (moreCount > 0) {
      response += `\n\n${t('list.moreItems', { count: moreCount })}`;
    }

    return {
      response,
      files: listedPaths,
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
    } catch (error) {
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
