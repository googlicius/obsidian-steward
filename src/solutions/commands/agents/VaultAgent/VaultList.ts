import { tool } from 'ai';
import { z } from 'zod';
import { TFile } from 'obsidian';
import { getTranslation } from 'src/i18n';
import type VaultAgent from './VaultAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

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
    explanation: z.string().describe('A brief explanation of why listing files is necessary.'),
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
    parameters: listToolSchema,
  });

  constructor(private readonly agent: VaultAgent) {}

  public static getListTool() {
    return VaultList.listTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, ListToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultList.handle invoked without handlerId');
    }

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: toolCall.args.explanation,
      agent: 'vault',
      command: 'vault_list',
      includeHistory: false,
      lang,
      handlerId,
    });

    const result = await this.executeListTool(toolCall.args, lang);

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: result.response,
      agent: 'vault',
      command: 'vault_list',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.serializeListInvocation({
      title,
      handlerId,
      toolCall,
      result,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async executeListTool(
    args: ListToolArgs,
    lang: string | null | undefined
  ): Promise<ListToolResult> {
    const folderPath = args.folderPath;
    const filePattern = args.filePattern?.trim();
    const t = getTranslation(lang);
    const errors: string[] = [];

    // Determine folder path - use empty string for root folder
    const targetFolderPath = !folderPath ? '' : folderPath;

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
    const folder = this.agent.app.vault.getFolderByPath(targetFolderPath);
    if (!folder) {
      const errorMessage = folderPath ? `Folder not found: ${folderPath}` : 'Root folder not found';
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
    for (const file of files) {
      fileLinks.push(`- [[${file.path}]]`);
    }

    const headerKey = folderPath ? 'list.foundFilesInFolder' : 'list.foundFiles';
    const response = `${t(headerKey, {
      count: files.length,
      folder: folderPath,
    })}:\n\n${fileLinks.join('\n')}`;

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

  private async serializeListInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, ListToolArgs>;
    result: ListToolResult;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'vault',
      command: 'vault_list',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result: {
            files: result.files,
            ...(result.errors && result.errors.length > 0 && { errors: result.errors }),
          },
        },
      ],
    });
  }
}
