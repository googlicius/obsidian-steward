import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { logger } from 'src/utils/logger';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { SysError } from 'src/utils/errors';

const revertRenameToolSchema = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe('The artifact identifier containing rename operations to revert.'),
  explanation: z
    .string()
    .min(1)
    .describe('A short explanation of why these renames should be reverted.'),
});

export type RevertRenameToolArgs = z.infer<typeof revertRenameToolSchema>;

type RevertRenameExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

export class RevertRename {
  private static readonly revertRenameTool = tool({ inputSchema: revertRenameToolSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getRevertRenameTool() {
    return RevertRename.revertRenameTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<RevertRenameToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new SysError('RevertRename.handle invoked without handlerId');
    }

    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'revert_rename',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveRenamesResult = await this.resolveRenames({
      title,
      toolCall,
      lang,
      handlerId,
    });

    if (resolveRenamesResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveRenamesResult.errorMessage),
      };
    }

    const renamePairs = resolveRenamesResult.renamePairs;

    if (renamePairs.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const revertResult = await this.executeRevert({
      title,
      renamePairs,
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
      command: 'revert_rename',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      title,
      handlerId,
      toolCall,
      command: 'revert_rename',
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

  private async resolveRenames(params: {
    title: string;
    toolCall: ToolCallPart<RevertRenameToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ renamePairs: Array<[string, string]>; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!toolCall.input.artifactId) {
      const message = t('common.noRecentOperations') || 'No artifact ID provided.';
      return { renamePairs: [], errorMessage: message };
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.input.artifactId);

    if (!artifact) {
      logger.error(`Revert rename tool artifact not found: ${toolCall.input.artifactId}`);
      const message = t('common.noRecentOperations') || 'No recent operations found.';
      return { renamePairs: [], errorMessage: message };
    }

    if (artifact.artifactType !== ArtifactType.RENAME_RESULTS) {
      const message = t('common.cannotRevertThisType', { type: artifact.artifactType });

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        command: 'revert_rename',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        title,
        handlerId,
        command: 'revert_rename',
        toolCall,
        result: {
          type: 'text',
          value: messageId ? `messageRef:${messageId}` : message,
        },
      });

      return { renamePairs: [], errorMessage: message };
    }

    // Extract rename pairs from the artifact
    // renames is an array of [originalPath, renamedPath] pairs
    // To revert, we need to rename from renamedPath back to originalPath
    const renamePairs: Array<[string, string]> = artifact.renames.map(
      ([originalPath, renamedPath]) => [renamedPath, originalPath]
    );

    return { renamePairs };
  }

  private async executeRevert(params: {
    title: string;
    renamePairs: Array<[string, string]>; // Array of [currentPath, originalPath] pairs
  }): Promise<RevertRenameExecutionResult> {
    const { renamePairs } = params;
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const [currentPath, originalPath] of renamePairs) {
      const result = await this.revertFileRename({ currentPath, originalPath });
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

  private async revertFileRename(params: {
    currentPath: string;
    originalPath: string;
  }): Promise<{ success: boolean; originalPath: string }> {
    const { currentPath, originalPath } = params;

    const file = this.agent.app.vault.getFileByPath(currentPath);

    if (!file) {
      logger.error(`File not found for revert rename: ${currentPath}`);
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

      // Rename file back to original location
      await this.agent.app.fileManager.renameFile(file, originalPath);

      return {
        success: true,
        originalPath,
      };
    } catch (error) {
      logger.error(`Error reverting rename from ${currentPath} to ${originalPath}:`, error);
      return { success: false, originalPath };
    }
  }
}
