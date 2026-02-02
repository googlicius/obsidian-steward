import { getCdnLib } from 'src/utils/cdnUrls';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { logger } from 'src/utils/logger';
import { NonTrashFile, TrashFile } from 'src/services/TrashCleanupService';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { OperationError } from 'src/tools/obsidianAPITools';

export const deleteToolSchema = z.object(
  {
    operations: z
      .array(
        z.discriminatedUnion('mode', [
          z.object(
            {
              mode: z.literal('artifactId'),
              artifactId: z
                .string()
                .min(1)
                .describe('The artifact identifier containing files to delete.'),
            },
            {
              description:
                'Delete by artifactId. Use this when: 1. Provided by user or tool call results (Do NOT guess), and 2. The files is a part of a larger list.',
            }
          ),
          z.object(
            {
              mode: z.literal('files'),
              files: z.array(z.string()).min(1).describe('The list of files that must be deleted.'),
            },
            {
              description:
                'Delete by file paths. DO NOT use this when you have a paginated list, where the files number is smaller than the total count.',
            }
          ),
          z.object(
            {
              mode: z.literal('filePatterns'),
              filePatterns: z
                .object({
                  patterns: z
                    .array(z.string().min(1))
                    .min(1)
                    .describe('Array of RegExp patterns to match files for deletion.'),
                  folder: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(
                      'Optional folder path to limit pattern matching. If not provided, searches entire vault.'
                    ),
                })
                .describe(
                  'Pattern-based file selection for large file sets. Prefer this over the files array to avoid token limits.'
                ),
            },
            {
              description:
                'Delete by file patterns. Pattern-based file selection for large file sets. Prefer this over the files array to avoid token limits.',
            }
          ),
        ])
      )
      .min(1)
      .describe('Array of delete operations to execute.'),
  },
  {
    description: 'A tool to delete files from the vault using various selection methods.',
  }
);

export type DeleteToolArgs = z.infer<typeof deleteToolSchema>;

type DeleteExecutionResult = {
  deletedFiles: (TrashFile | NonTrashFile)[];
  trashFiles: TrashFile[];
  failedFiles: OperationError[];
  operationArtifactId?: string;
};

export class VaultDelete {
  constructor(private readonly agent: SuperAgent) {}

  public static async getDeleteTool() {
    const { tool } = await getCdnLib('ai');
    return tool({ inputSchema: deleteToolSchema });
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<DeleteToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const t = getTranslation(params.lang);

    if (!params.handlerId) {
      throw new Error('VaultDelete.handle invoked without handlerId');
    }

    const resolveFilesResult = await this.resolveFilePaths({
      title: params.title,
      toolCall,
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.invocationCount,
    });

    if (resolveFilesResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveFilesResult.errorMessage),
      };
    }

    const filePaths = resolveFilesResult.filePaths;

    if (filePaths.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const operationArtifactId = `delete_${Date.now()}`;
    const deleteResult = await this.executeDelete({
      title: params.title,
      filePaths,
      operationArtifactId,
      lang: params.lang,
    });

    let response = t('delete.foundFiles', { count: filePaths.length });

    if (deleteResult.deletedFiles.length > 0) {
      response += `\n\n**${t('delete.successfullyDeleted', {
        count: deleteResult.deletedFiles.length,
      })}**`;

      for (const deletedFile of deleteResult.deletedFiles) {
        response += `\n- [[${deletedFile.originalPath}]]`;
      }
    }

    if (deleteResult.failedFiles.length > 0) {
      response += `\n\n**${t('delete.failed', { count: deleteResult.failedFiles.length })}**`;

      for (const failedPath of deleteResult.failedFiles) {
        response += `\n- [[${failedPath.path}]]`;
        if (failedPath.message) {
          response += `: ${failedPath.message}`;
        }
      }
    }

    const messageId = await this.agent.renderer.updateConversationNote({
      path: params.title,
      newContent: response,
      command: 'vault_delete',
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.invocationCount,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      command: 'vault_delete',
      title: params.title,
      handlerId: params.handlerId,
      step: params.invocationCount,
      toolCall,
      result: {
        type: 'text',
        value: messageId ? `messageRef:${messageId}` : response,
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveFilePaths(params: {
    title: string;
    toolCall: ToolCallPart<DeleteToolArgs>;
    lang?: string | null;
    handlerId: string;
    step?: number;
  }): Promise<{ filePaths: string[]; errorMessage?: string }> {
    const t = getTranslation(params.lang);

    const filePaths: string[] = [];
    const noFilesMessage = t('common.noFilesFound');

    for (const operation of params.toolCall.input.operations) {
      switch (operation.mode) {
        case 'artifactId': {
          const artifactManager = this.agent.plugin.artifactManagerV2.withTitle(params.title);
          const resolvedFiles = await artifactManager.resolveFilesFromArtifact(
            operation.artifactId
          );

          if (resolvedFiles.length > 0) {
            // Extract paths from DocWithPath objects
            filePaths.push(...resolvedFiles.map(file => file.path));
          }
          break;
        }

        case 'files': {
          for (const filePath of operation.files) {
            const file = await this.agent.plugin.mediaTools.findFileByNameOrPath(filePath);
            if (file) {
              filePaths.push(file.path);
            }
          }
          break;
        }

        case 'filePatterns': {
          const patternMatchedPaths = this.agent.obsidianAPITools.resolveFilePatterns(
            operation.filePatterns.patterns,
            operation.filePatterns.folder
          );
          filePaths.push(...patternMatchedPaths);
          break;
        }
      }
    }

    if (filePaths.length === 0) {
      const noFilesMessageId = await this.agent.renderer.updateConversationNote({
        path: params.title,
        newContent: noFilesMessage,
        command: 'vault_delete',
        lang: params.lang,
        handlerId: params.handlerId,
        step: params.step,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        command: 'vault_delete',
        title: params.title,
        handlerId: params.handlerId,
        step: params.step,
        toolCall: params.toolCall,
        result: {
          type: 'error-text',
          value: noFilesMessageId ? `messageRef:${noFilesMessageId}` : noFilesMessage,
        },
      });

      return { filePaths: [], errorMessage: noFilesMessage };
    }

    return { filePaths };
  }

  private async executeDelete(params: {
    title: string;
    filePaths: string[];
    operationArtifactId: string;
    lang?: string | null;
  }): Promise<DeleteExecutionResult> {
    const t = getTranslation(params.lang);
    const isStwTrash = this.agent.plugin.settings.deleteBehavior.behavior === 'stw_trash';
    const deletedFiles: (TrashFile | NonTrashFile)[] = [];
    const failedFiles: OperationError[] = [];
    const trashFiles: TrashFile[] = [];

    const currentConversationPath = this.getCurrentConversationPath(params.title);

    for (const filePath of params.filePaths) {
      // Safety check: skip current conversation note to avoid corrupting ongoing conversation
      if (this.isCurrentConversationNote(filePath, currentConversationPath)) {
        failedFiles.push({
          path: filePath,
          message: t('delete.cannotDeleteCurrentConversationNote'),
        });
        continue;
      }

      const result = await this.trashFile({ filePath });
      if (!result.success) {
        failedFiles.push({ path: result.originalPath, message: '' });
        continue;
      }

      if (result.trashPath) {
        const trashFile: TrashFile = {
          originalPath: result.originalPath,
          trashPath: result.trashPath,
        };
        deletedFiles.push(trashFile);
        trashFiles.push(trashFile);
        continue;
      }

      deletedFiles.push({
        originalPath: result.originalPath,
      });
    }

    if (isStwTrash && trashFiles.length > 0) {
      await this.agent.plugin.trashCleanupService.addFilesToTrash({
        files: trashFiles,
        artifactId: params.operationArtifactId,
      });

      await this.agent.plugin.artifactManagerV2.withTitle(params.title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.DELETED_FILES,
          fileCount: trashFiles.length,
          id: params.operationArtifactId,
          createdAt: Date.now(),
        },
      });

      return {
        deletedFiles,
        trashFiles,
        failedFiles,
        operationArtifactId: params.operationArtifactId,
      };
    }

    return {
      deletedFiles,
      trashFiles,
      failedFiles,
    };
  }

  private async trashFile(params: {
    filePath: string;
  }): Promise<{ success: boolean; trashPath?: string; originalPath: string }> {
    const { filePath } = params;
    const deleteBehavior = this.agent.plugin.settings.deleteBehavior.behavior;
    const file = this.agent.app.vault.getFileByPath(filePath);

    if (!file) {
      return { success: false, originalPath: filePath };
    }

    if (deleteBehavior !== 'stw_trash') {
      try {
        await this.agent.app.fileManager.trashFile(file);
        return { success: true, originalPath: filePath };
      } catch (error) {
        logger.error(`Error deleting file ${filePath} using Obsidian trash:`, error);
        return { success: false, originalPath: filePath };
      }
    }

    const trashFolder = `${this.agent.plugin.settings.stewardFolder}/Trash`;
    const extension = file.extension ? `.${file.extension}` : '';
    const uniqueFileName = `${file.basename}_${Date.now()}${extension}`;

    try {
      await this.agent.obsidianAPITools.ensureFolderExists(trashFolder);
      const trashPath = `${trashFolder}/${uniqueFileName}`;
      await this.agent.app.fileManager.renameFile(file, trashPath);

      return {
        success: true,
        originalPath: filePath,
        trashPath,
      };
    } catch (error) {
      logger.error(`Error moving file ${filePath} to Steward trash:`, error);
      return { success: false, originalPath: filePath };
    }
  }

  /**
   * Get the full path of the current conversation note
   */
  private getCurrentConversationPath(title: string): string {
    return `${this.agent.plugin.settings.stewardFolder}/Conversations/${title}.md`;
  }

  /**
   * Check if a file path matches the current conversation note
   * Handles both with and without .md extension, and normalized paths
   */
  private isCurrentConversationNote(filePath: string, currentConversationPath: string): boolean {
    // Normalize paths for comparison (handle different path separators and extensions)
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    const normalizedConversationPath = currentConversationPath.replace(/\\/g, '/');

    // Check exact match
    if (normalizedFilePath === normalizedConversationPath) {
      return true;
    }

    // Check without .md extension (in case filePath doesn't include it)
    const conversationPathWithoutExt = normalizedConversationPath.replace(/\.md$/, '');
    const filePathWithoutExt = normalizedFilePath.replace(/\.md$/, '');
    if (filePathWithoutExt === conversationPathWithoutExt) {
      return true;
    }

    return false;
  }
}
