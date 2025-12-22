import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { logger } from 'src/utils/logger';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { OperationError } from 'src/tools/obsidianAPITools';
import { SysError } from 'src/utils/errors';

const revertMoveToolSchema = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe('The artifact identifier containing move operations to revert.'),
  explanation: z
    .string()
    .min(1)
    .describe('A short explanation of why these moves should be reverted.'),
});

export type RevertMoveToolArgs = z.infer<typeof revertMoveToolSchema>;

type RevertMoveExecutionResult = {
  revertedFiles: string[];
  failedFiles: OperationError[];
};

export class RevertMove {
  private static readonly revertMoveTool = tool({ inputSchema: revertMoveToolSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getRevertMoveTool() {
    return RevertMove.revertMoveTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<RevertMoveToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new SysError('RevertMove.handle invoked without handlerId');
    }

    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'revert_move',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveMovesResult = await this.resolveMoves({
      title,
      toolCall,
      lang,
      handlerId,
    });

    if (resolveMovesResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveMovesResult.errorMessage),
      };
    }

    const movePairs = resolveMovesResult.movePairs;

    if (movePairs.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const revertResult = await this.executeRevert({
      title,
      movePairs,
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

      for (const error of revertResult.failedFiles) {
        const isFile = Boolean(this.agent.app.vault.getFileByPath(error.path));
        if (isFile) {
          response += `\n- [[${error.path}]] - ${error.message}`;
        } else {
          response += `\n- \`${error.path}\` - ${error.message}`;
        }
      }
    }

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      command: 'revert_move',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      command: 'revert_move',
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

  private async resolveMoves(params: {
    title: string;
    toolCall: ToolCallPart<RevertMoveToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ movePairs: Array<[string, string]>; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!toolCall.input.artifactId) {
      const message = t('common.noRecentOperations') || 'No artifact ID provided.';
      return { movePairs: [], errorMessage: message };
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.input.artifactId);

    if (!artifact) {
      logger.error(`Revert move tool artifact not found: ${toolCall.input.artifactId}`);
      const message = t('common.noRecentOperations') || 'No recent operations found.';
      return { movePairs: [], errorMessage: message };
    }

    if (artifact.artifactType !== ArtifactType.MOVE_RESULTS) {
      const message = t('common.cannotRevertThisType', { type: artifact.artifactType });

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        command: 'revert_move',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        title,
        handlerId,
        command: 'revert_move',
        toolCall,
        result: {
          type: 'text',
          value: messageId ? `messageRef:${messageId}` : message,
        },
      });

      return { movePairs: [], errorMessage: message };
    }

    // Extract move pairs from the artifact
    // moves is an array of [originalPath, movedPath] pairs
    // To revert, we need to move from movedPath back to originalPath
    const movePairs: Array<[string, string]> = artifact.moves.map(([originalPath, movedPath]) => [
      movedPath,
      originalPath,
    ]);

    return { movePairs };
  }

  private async executeRevert(params: {
    title: string;
    movePairs: Array<[string, string]>; // Array of [currentPath, originalPath] pairs
  }): Promise<RevertMoveExecutionResult> {
    const { movePairs } = params;
    const revertedFiles: string[] = [];
    const failedFiles: OperationError[] = [];

    for (const [currentPath, originalPath] of movePairs) {
      const result = await this.revertFileMove({ currentPath, originalPath });
      if (!result.success) {
        failedFiles.push({
          path: currentPath,
          message: result.error || 'Unknown error',
        });
        continue;
      }

      revertedFiles.push(originalPath);
    }

    return {
      revertedFiles,
      failedFiles,
    };
  }

  private async revertFileMove(params: {
    currentPath: string;
    originalPath: string;
  }): Promise<{ success: boolean; originalPath: string; error?: string }> {
    const { currentPath, originalPath } = params;

    // Check if it's a file or folder
    const file = this.agent.app.vault.getFileByPath(currentPath);
    const folder = this.agent.app.vault.getFolderByPath(currentPath);

    if (!file && !folder) {
      const errorMessage = `File or folder not found: ${currentPath}`;
      logger.error(`File or folder not found for revert move: ${currentPath}`);
      return { success: false, originalPath, error: errorMessage };
    }

    // Check if original path already exists
    const originalFile = this.agent.app.vault.getFileByPath(originalPath);
    const originalFolder = this.agent.app.vault.getFolderByPath(originalPath);
    if (originalFile || originalFolder) {
      const errorMessage = `Original file or folder already exists: ${originalPath}`;
      logger.warn(`Original file or folder already exists: ${originalPath}`);
      return { success: false, originalPath, error: errorMessage };
    }

    try {
      // Ensure the parent folder of the original path exists
      const parentFolder = originalPath.substring(0, originalPath.lastIndexOf('/'));
      if (parentFolder) {
        await this.agent.obsidianAPITools.ensureFolderExists(parentFolder);
      }

      // Move file or folder back to original location
      const itemToMove = file || folder;
      if (itemToMove) {
        await this.agent.app.fileManager.renameFile(itemToMove, originalPath);
      }

      return {
        success: true,
        originalPath,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
      logger.error(`Error reverting move from ${currentPath} to ${originalPath}:`, error);
      return { success: false, originalPath, error: errorMessage };
    }
  }
}
