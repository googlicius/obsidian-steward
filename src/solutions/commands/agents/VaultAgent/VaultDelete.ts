import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type VaultAgent from './VaultAgent';
import { logger } from 'src/utils/logger';
import { NonTrashFile, TrashFile } from 'src/services/TrashCleanupService';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

const deleteToolSchema = z
  .object({
    artifactId: z
      .string()
      .min(1)
      .optional()
      .describe('The artifact identifier containing files to delete.'),
    files: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .describe('The full path (including extension) of the file to delete.'),
        })
      )
      .optional()
      .refine(array => !array || array.length > 0, {
        message: 'files array must include at least one entry when provided.',
      })
      .describe('The list of files that must be deleted.'),
    explanation: z
      .string()
      .min(1)
      .describe('A short explanation of why these files should be deleted.'),
  })
  .refine(data => Boolean(data.artifactId) || Boolean(data.files && data.files.length > 0), {
    message: 'Provide either artifactId or files.',
  });

export type DeleteToolArgs = z.infer<typeof deleteToolSchema>;

type DeleteExecutionResult = {
  deletedFiles: (TrashFile | NonTrashFile)[];
  trashFiles: TrashFile[];
  failedFiles: string[];
  operationArtifactId?: string;
};

export class VaultDelete {
  private static readonly deleteTool = tool({ parameters: deleteToolSchema });

  constructor(private readonly agent: VaultAgent) {}

  public static getDeleteTool() {
    return VaultDelete.deleteTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, DeleteToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('VaultDelete.handle invoked without handlerId');
    }

    if (toolCall.args.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        agent: 'vault',
        command: 'vault_delete',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveFilesResult = await this.resolveFilePaths({
      title,
      toolCall,
      lang,
      handlerId,
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
      title,
      filePaths,
      operationArtifactId,
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
        response += `\n- [[${failedPath}]]`;
      }
    }

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      agent: 'vault',
      command: 'vault_delete',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.serializeDeleteInvocation({
      title,
      handlerId,
      toolCall,
      result: messageId ? `messageRef:${messageId}` : response,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveFilePaths(params: {
    title: string;
    toolCall: ToolInvocation<unknown, DeleteToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ filePaths: string[]; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    const filePaths: string[] = [];
    let noFilesMessage = t('common.noFilesFound');

    if (toolCall.args.artifactId) {
      const artifact = await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .getArtifactById(toolCall.args.artifactId);

      if (!artifact) {
        logger.error(`Delete tool artifact not found: ${toolCall.args.artifactId}`);
        noFilesMessage = t('common.noRecentOperations');
      } else if (artifact.artifactType === ArtifactType.SEARCH_RESULTS) {
        for (const result of artifact.originalResults) {
          filePaths.push(result.document.path);
        }
      } else if (artifact.artifactType === ArtifactType.CREATED_NOTES) {
        for (const path of artifact.paths) {
          filePaths.push(path);
        }
      } else {
        const message = t('common.cannotDeleteThisType', { type: artifact.artifactType });

        const messageId = await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: message,
          agent: 'vault',
          command: 'vault_delete',
          lang,
          handlerId,
          includeHistory: false,
        });

        await this.serializeDeleteInvocation({
          title,
          handlerId,
          toolCall,
          result: messageId ? `messageRef:${messageId}` : message,
        });

        return { filePaths: [], errorMessage: message };
      }
    }

    if (toolCall.args.files) {
      for (const item of toolCall.args.files) {
        const file = await this.agent.plugin.mediaTools.findFileByNameOrPath(item.path);
        if (file) {
          filePaths.push(file.path);
        }
      }
    }

    if (filePaths.length === 0) {
      const noFilesMessageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: noFilesMessage,
        agent: 'vault',
        command: 'vault_delete',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.serializeDeleteInvocation({
        title,
        handlerId,
        toolCall,
        result: noFilesMessageId ? `messageRef:${noFilesMessageId}` : noFilesMessage,
      });

      return { filePaths: [], errorMessage: noFilesMessage };
    }

    return { filePaths };
  }

  private async executeDelete(params: {
    title: string;
    filePaths: string[];
    operationArtifactId: string;
  }): Promise<DeleteExecutionResult> {
    const { title, filePaths, operationArtifactId } = params;
    const isStwTrash = this.agent.plugin.settings.deleteBehavior.behavior === 'stw_trash';
    const deletedFiles: (TrashFile | NonTrashFile)[] = [];
    const failedFiles: string[] = [];
    const trashFiles: TrashFile[] = [];

    for (const filePath of filePaths) {
      const result = await this.trashFile({ filePath });
      if (!result.success) {
        failedFiles.push(result.originalPath);
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
        artifactId: operationArtifactId,
      });

      await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.DELETED_FILES,
          fileCount: trashFiles.length,
          id: operationArtifactId,
          createdAt: Date.now(),
        },
      });

      return {
        deletedFiles,
        trashFiles,
        failedFiles,
        operationArtifactId,
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

  private async serializeDeleteInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, DeleteToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'vault',
      command: 'vault_delete',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result,
        },
      ],
    });
  }
}
