import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type RevertAgent from './RevertAgent';
import { logger } from 'src/utils/logger';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

const revertDeleteToolSchema = z
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

export type RevertDeleteToolArgs = z.infer<typeof revertDeleteToolSchema>;

type RevertDeleteExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

export class RevertDelete {
  private static readonly revertDeleteTool = tool({ parameters: revertDeleteToolSchema });

  constructor(private readonly agent: RevertAgent) {}

  public static getRevertDeleteTool() {
    return RevertDelete.revertDeleteTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, RevertDeleteToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('RevertDelete.handle invoked without handlerId');
    }

    if (toolCall.args.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        agent: 'revert',
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
      agent: 'revert',
      command: 'revert_delete',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.serializeRevertInvocation({
      title,
      handlerId,
      toolCall,
      result: messageId ? `messageRef:${messageId}` : response,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveTrashFiles(params: {
    title: string;
    toolCall: ToolInvocation<unknown, RevertDeleteToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ trashFiles: string[]; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    const trashFiles: string[] = [];
    let noFilesMessage = t('common.noFilesFound');

    if (toolCall.args.artifactId) {
      const artifact = await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .getArtifactById(toolCall.args.artifactId);

      if (!artifact) {
        logger.error(`Revert delete tool artifact not found: ${toolCall.args.artifactId}`);
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
          agent: 'revert',
          command: 'revert_delete',
          lang,
          handlerId,
          includeHistory: false,
        });

        await this.serializeRevertInvocation({
          title,
          handlerId,
          toolCall,
          result: messageId ? `messageRef:${messageId}` : message,
        });

        return { trashFiles: [], errorMessage: message };
      }
    }

    if (toolCall.args.trashFiles) {
      for (const file of toolCall.args.trashFiles) {
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
        agent: 'revert',
        command: 'revert_delete',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.serializeRevertInvocation({
        title,
        handlerId,
        toolCall,
        result: noFilesMessageId ? `messageRef:${noFilesMessageId}` : noFilesMessage,
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

  private async serializeRevertInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, RevertDeleteToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'revert',
      command: 'revert_delete',
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
