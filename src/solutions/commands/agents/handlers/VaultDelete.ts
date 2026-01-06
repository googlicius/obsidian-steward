import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { logger } from 'src/utils/logger';
import { NonTrashFile, TrashFile } from 'src/services/TrashCleanupService';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import {
  createArtifactIdSchema,
  createFilesSchemaString,
  createFilePatternsSchema,
} from './vaultOperationSchemas';

export const deleteToolSchema = z
  .object(
    {
      artifactId: createArtifactIdSchema({
        description: 'The artifact identifier containing files to delete.',
      }),
      files: createFilesSchemaString({
        description: 'The list of files that must be deleted.',
      }),
      filePatterns: createFilePatternsSchema({
        description:
          'Pattern-based file selection for large file sets. Prefer this over the files array to avoid token limits.',
        patternsDescription: 'Array of RegExp patterns to match files for deletion.',
      }),
    },
    {
      description: 'Provide exactly ONE of artifactId, files, or filePatterns.',
    }
  )
  .refine(
    data => {
      const hasArtifactId = Boolean(data.artifactId);
      const hasFiles = Boolean(data.files && data.files.length > 0);
      const hasFilePatterns = Boolean(
        data.filePatterns && data.filePatterns.patterns && data.filePatterns.patterns.length > 0
      );
      const providedCount = [hasArtifactId, hasFiles, hasFilePatterns].filter(Boolean).length;
      return providedCount === 1;
    },
    {
      message: 'You can only provide either artifactId, files, or filePatterns.',
    }
  );

export type DeleteToolArgs = z.infer<typeof deleteToolSchema>;

type DeleteExecutionResult = {
  deletedFiles: (TrashFile | NonTrashFile)[];
  trashFiles: TrashFile[];
  failedFiles: string[];
  operationArtifactId?: string;
};

export class VaultDelete {
  private static readonly deleteTool = tool({ inputSchema: deleteToolSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getDeleteTool() {
    return VaultDelete.deleteTool;
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

    if (params.toolCall.input.artifactId) {
      const artifactManager = this.agent.plugin.artifactManagerV2.withTitle(params.title);
      const resolvedFiles = await artifactManager.resolveFilesFromArtifact(
        params.toolCall.input.artifactId
      );

      if (resolvedFiles.length === 0) {
        // No files found in artifact, continue to check other sources
        // The noFilesMessage will be handled at the end if no files are found
      } else {
        // Extract paths from DocWithPath objects
        filePaths.push(...resolvedFiles.map(file => file.path));
      }
    }

    if (params.toolCall.input.files) {
      for (const filePath of params.toolCall.input.files) {
        const file = await this.agent.plugin.mediaTools.findFileByNameOrPath(filePath);
        if (file) {
          filePaths.push(file.path);
        }
      }
    }

    if (params.toolCall.input.filePatterns) {
      const patternMatchedPaths = this.agent.obsidianAPITools.resolveFilePatterns(
        params.toolCall.input.filePatterns.patterns,
        params.toolCall.input.filePatterns.folder
      );
      filePaths.push(...patternMatchedPaths);
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
  }): Promise<DeleteExecutionResult> {
    const isStwTrash = this.agent.plugin.settings.deleteBehavior.behavior === 'stw_trash';
    const deletedFiles: (TrashFile | NonTrashFile)[] = [];
    const failedFiles: string[] = [];
    const trashFiles: TrashFile[] = [];

    for (const filePath of params.filePaths) {
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
}
