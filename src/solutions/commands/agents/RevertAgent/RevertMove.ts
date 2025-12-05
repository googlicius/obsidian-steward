import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type RevertAgent from './RevertAgent';
import { logger } from 'src/utils/logger';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

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
  failedFiles: string[];
};

export class RevertMove {
  private static readonly revertMoveTool = tool({ parameters: revertMoveToolSchema });

  constructor(private readonly agent: RevertAgent) {}

  public static getRevertMoveTool() {
    return RevertMove.revertMoveTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, RevertMoveToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('RevertMove.handle invoked without handlerId');
    }

    if (toolCall.args.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        agent: 'revert',
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

      for (const failedPath of revertResult.failedFiles) {
        response += `\n- [[${failedPath}]]`;
      }
    }

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      agent: 'revert',
      command: 'revert_move',
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

  private async resolveMoves(params: {
    title: string;
    toolCall: ToolInvocation<unknown, RevertMoveToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ movePairs: Array<[string, string]>; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!toolCall.args.artifactId) {
      const message = t('common.noRecentOperations') || 'No artifact ID provided.';
      return { movePairs: [], errorMessage: message };
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.args.artifactId);

    if (!artifact) {
      logger.error(`Revert move tool artifact not found: ${toolCall.args.artifactId}`);
      const message = t('common.noRecentOperations') || 'No recent operations found.';
      return { movePairs: [], errorMessage: message };
    }

    if (artifact.artifactType !== ArtifactType.MOVE_RESULTS) {
      const message =
        t('common.cannotRevertThisType', { type: artifact.artifactType }) ||
        `Cannot revert this type of artifact: ${artifact.artifactType}`;

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        agent: 'revert',
        command: 'revert_move',
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
    const failedFiles: string[] = [];

    for (const [currentPath, originalPath] of movePairs) {
      const result = await this.revertFileMove({ currentPath, originalPath });
      if (!result.success) {
        failedFiles.push(currentPath);
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
  }): Promise<{ success: boolean; originalPath: string }> {
    const { currentPath, originalPath } = params;

    const file = this.agent.app.vault.getFileByPath(currentPath);

    if (!file) {
      logger.error(`File not found for revert move: ${currentPath}`);
      return { success: false, originalPath };
    }

    // Check if original path already exists
    const originalFile = this.agent.app.vault.getFileByPath(originalPath);
    if (originalFile) {
      logger.warn(`Original file already exists: ${originalPath}`);
      return { success: false, originalPath };
    }

    try {
      // Ensure the original folder exists
      const originalFolder = originalPath.substring(0, originalPath.lastIndexOf('/'));
      if (originalFolder) {
        await this.agent.obsidianAPITools.ensureFolderExists(originalFolder);
      }

      // Move file back to original location
      await this.agent.app.fileManager.renameFile(file, originalPath);

      return {
        success: true,
        originalPath,
      };
    } catch (error) {
      logger.error(`Error reverting move from ${currentPath} to ${originalPath}:`, error);
      return { success: false, originalPath };
    }
  }

  private async serializeRevertInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, RevertMoveToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'revert',
      command: 'revert_move',
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
