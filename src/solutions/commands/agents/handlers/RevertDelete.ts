import { z } from 'zod/v3';
import { getCdnLib } from 'src/utils/cdnUrls';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { logger } from 'src/utils/logger';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { SysError } from 'src/utils/errors';

const revertDeleteSchema = z
  .object({
    artifactId: z
      .string()
      .min(1)
      .optional()
      .describe('The artifact identifier containing deleted files to revert.'),
    trashFiles: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .describe(
              'The full path (including extension) of the file in the trash folder to revert.'
            ),
        })
      )
      .optional()
      .refine(array => !array || array.length > 0, {
        message: 'trashFiles array must include at least one entry when provided.',
      })
      .describe('The list of trash files that should be reverted.'),
    explanation: z
      .string()
      .min(1)
      .describe('A short explanation of why these files should be reverted.'),
  })
  .refine(
    data => Boolean(data.artifactId) || Boolean(data.trashFiles && data.trashFiles.length > 0),
    {
      message: 'Provide either artifactId or trashFiles.',
    }
  );

export type RevertDeleteToolArgs = z.infer<typeof revertDeleteSchema>;

type RevertDeleteExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

export class RevertDelete {
  constructor(private readonly agent: SuperAgent) {}

  public static async getRevertDeleteTool() {
    const { tool } = await getCdnLib('ai');
    return tool({ inputSchema: revertDeleteSchema });
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<RevertDeleteToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new SysError('RevertDelete.handle invoked without handlerId');
    }

    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'revert_delete',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveTrashFilesResult = await this.resolveTrashFiles({
      title,
      toolCall,
      lang,
      handlerId,
    });

    if (resolveTrashFilesResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveTrashFilesResult.errorMessage),
      };
    }

    const trashFiles = resolveTrashFilesResult.trashFiles;

    if (trashFiles.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const revertResult = await this.executeRevert({
      title,
      trashFiles,
    });

    let response = '';

    if (revertResult.revertedFiles.length > 0) {
      response = `**${t('revert.successfullyReverted', {
        count: revertResult.revertedFiles.length,
      })}**`;
    }

    if (revertResult.failedFiles.length > 0) {
      if (response) {
        response += '\n\n';
      }
      response += `**${t('revert.failed', { count: revertResult.failedFiles.length })}**`;

      for (const failedPath of revertResult.failedFiles) {
        response += `\n- [[${failedPath}]]`;
      }
    }

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      command: 'revert_delete',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      command: 'revert_delete',
      title,
      handlerId,
      toolCall,
      result: {
        type: 'text',
        value: messageId ? `messageRef:${messageId}` : response,
      },
    });

    // Remove the artifact if revert was successful and artifactId was provided
    if (toolCall.input.artifactId && revertResult.revertedFiles.length > 0) {
      await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .removeArtifact(toolCall.input.artifactId, toolCall.input.explanation);
    }

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveTrashFiles(params: {
    title: string;
    toolCall: ToolCallPart<RevertDeleteToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ trashFiles: string[]; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    const trashFiles: string[] = [];
    let noFilesMessage = t('common.noFilesFound');

    if (toolCall.input.artifactId) {
      const artifact = await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .getArtifactById(toolCall.input.artifactId);

      if (!artifact) {
        logger.error(`Revert delete tool artifact not found: ${toolCall.input.artifactId}`);
        noFilesMessage = t('common.noRecentOperations');
      } else if (artifact.artifactType === ArtifactType.DELETED_FILES) {
        // Get all trash metadata
        const metadata = await this.agent.plugin.trashCleanupService.getAllMetadata();

        // Find all trash files associated with this artifact ID
        for (const [trashPath, fileInfo] of Object.entries(metadata.files)) {
          if (fileInfo.artifactId === artifact.id) {
            trashFiles.push(trashPath);
          }
        }
      } else {
        const message = t('common.cannotRevertThisType', { type: artifact.artifactType });

        const messageId = await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: message,
          command: 'revert_delete',
          lang,
          handlerId,
          includeHistory: false,
        });

        await this.agent.serializeInvocation({
          command: 'revert_delete',
          title,
          handlerId,
          toolCall,
          result: {
            type: 'text',
            value: messageId ? `messageRef:${messageId}` : message,
          },
        });

        return { trashFiles: [], errorMessage: message };
      }
    }

    if (toolCall.input.trashFiles) {
      for (const file of toolCall.input.trashFiles) {
        const trimmedPath = file.path.trim();
        if (!trimmedPath) {
          continue;
        }
        trashFiles.push(trimmedPath);
      }
    }

    if (trashFiles.length === 0) {
      const noFilesMessageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: noFilesMessage,
        command: 'revert_delete',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        command: 'revert_delete',
        title,
        handlerId,
        toolCall,
        result: {
          type: 'error-text',
          value: noFilesMessageId ? `messageRef:${noFilesMessageId}` : noFilesMessage,
        },
      });

      return { trashFiles: [], errorMessage: noFilesMessage };
    }

    return { trashFiles };
  }

  private async executeRevert(params: {
    title: string;
    trashFiles: string[];
  }): Promise<RevertDeleteExecutionResult> {
    const { trashFiles } = params;
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const trashPath of trashFiles) {
      const result = await this.revertFile({ trashPath });
      if (!result.success) {
        failedFiles.push(result.trashPath);
        continue;
      }

      revertedFiles.push(result.originalPath);
    }

    return {
      revertedFiles,
      failedFiles,
    };
  }

  private async revertFile(params: {
    trashPath: string;
  }): Promise<{ success: boolean; originalPath: string; trashPath: string }> {
    const { trashPath } = params;

    // Get metadata for this trash file
    const metadata = await this.agent.plugin.trashCleanupService.getFileMetadata(trashPath);

    if (!metadata) {
      logger.error(`No metadata found for trash file: ${trashPath}`);
      return { success: false, originalPath: '', trashPath };
    }

    const file = this.agent.app.vault.getFileByPath(trashPath);

    if (!file) {
      logger.error(`Trash file not found: ${trashPath}`);
      return { success: false, originalPath: metadata.originalPath, trashPath };
    }

    // Check if original path already exists
    const originalFile = this.agent.app.vault.getFileByPath(metadata.originalPath);
    if (originalFile) {
      logger.warn(`Original file already exists: ${metadata.originalPath}`);
      return { success: false, originalPath: metadata.originalPath, trashPath };
    }

    try {
      // Ensure the original folder exists
      const originalFolder = metadata.originalPath.substring(
        0,
        metadata.originalPath.lastIndexOf('/')
      );
      if (originalFolder) {
        await this.agent.obsidianAPITools.ensureFolderExists(originalFolder);
      }

      // Move file back to original location
      await this.agent.app.fileManager.renameFile(file, metadata.originalPath);

      // Remove from trash metadata
      await this.agent.plugin.trashCleanupService.removeFileFromTrash(trashPath);

      return {
        success: true,
        originalPath: metadata.originalPath,
        trashPath,
      };
    } catch (error) {
      logger.error(`Error reverting file ${trashPath} to ${metadata.originalPath}:`, error);
      return { success: false, originalPath: metadata.originalPath, trashPath };
    }
  }
}
