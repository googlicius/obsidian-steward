import { tool } from 'ai';
import { z } from 'zod/v3';
import { TFile } from 'obsidian';
import { getTranslation } from 'src/i18n';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ArtifactType } from 'src/solutions/artifact';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';

const MAX_FILES_TO_SHOW = 10;

const listToolSchema = z.object(
  {
    folderPath: z
      .string()
      .transform(val => {
        // Sanitize folderPath: remove leading and trailing slashes, then trim
        let sanitized = val.trim();
        sanitized = sanitized.replace(/^\/+|\/+$/g, '');
        return sanitized;
      })
      .describe('The folder path to list files from. Specify / to lists from the root.'),
    filePattern: z
      .string()
      .optional()
      .describe(
        'Optional RegExp pattern to filter files. If not provided, all files will be listed.'
      ),
    lang: z
      .string()
      .nullable()
      .optional()
      .describe(userLanguagePrompt.content as string),
  },
  {
    description: `List all files in a specific folder. NOTE: This tool does not list folders but files only.`,
  }
);

export type ListToolArgs = z.infer<typeof listToolSchema>;

type ListToolResult = {
  response: string;
  files: string[];
  errors?: string[];
};

export class VaultList {
  protected static readonly listTool = tool({
    inputSchema: listToolSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getListTool() {
    return VaultList.listTool;
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

    await this.agent.renderer.updateConversationNote({
      path: params.title,
      newContent: result.response,
      command: 'vault_list',
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.invocationCount,
      includeHistory: false,
    });

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
      resultText += `\n\n${t('list.fullListAvailableInArtifact', { artifactId })}`;
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
      const messageKey = folderPath ? 'list.noFilesFoundInFolder' : 'list.noFilesFound';
      return {
        response: t(messageKey, { folder: folderPath }),
        files: [],
        errors,
      };
    }

    // Collect files from folder
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile) {
        // Apply pattern filter if provided
        if (filePattern) {
          if (this.matchesPattern(child.name, filePattern)) {
            files.push(child);
          }
        } else {
          files.push(child);
        }
      }
    }

    const filePaths = files.map(file => file.path);

    if (files.length === 0) {
      const messageKey = folderPath ? 'list.noFilesFoundInFolder' : 'list.noFilesFound';
      return {
        response: t(messageKey, { folder: folderPath }),
        files: [],
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    const fileLinks: string[] = [];
    for (let index = 0; index < files.length && index < MAX_FILES_TO_SHOW; index += 1) {
      const file = files[index];
      fileLinks.push(`- [[${file.path}]]`);
    }

    const moreCount = files.length > MAX_FILES_TO_SHOW ? files.length - MAX_FILES_TO_SHOW : 0;

    const headerKey = folderPath ? 'list.foundFilesInFolder' : 'list.foundFiles';
    let response = `${t(headerKey, {
      count: files.length,
      folder: folderPath,
    })}:\n\n${fileLinks.join('\n')}`;

    if (moreCount > 0) {
      response += `\n\n${t('list.moreFiles', { count: moreCount })}`;
    }

    return {
      response,
      files: filePaths,
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
}
