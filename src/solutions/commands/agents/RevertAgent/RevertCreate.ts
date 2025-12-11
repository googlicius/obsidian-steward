import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type RevertAgent from './RevertAgent';
import { logger } from 'src/utils/logger';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { SysError } from 'src/utils/errors';

const revertCreateToolSchema = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe('The artifact identifier containing created notes to revert.'),
  explanation: z
    .string()
    .min(1)
    .describe('A short explanation of why these created notes should be reverted.'),
});

export type RevertCreateToolArgs = z.infer<typeof revertCreateToolSchema>;

type RevertCreateExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

export class RevertCreate {
  private static readonly revertCreateTool = tool({ parameters: revertCreateToolSchema });

  constructor(private readonly agent: RevertAgent) {}

  public static getRevertCreateTool() {
    return RevertCreate.revertCreateTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, RevertCreateToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new SysError('RevertCreate.handle invoked without handlerId');
    }

    if (toolCall.args.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        agent: 'revert',
        command: 'revert_create',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveCreatedNotesResult = await this.resolveCreatedNotes({
      title,
      toolCall,
      lang,
      handlerId,
    });

    if (resolveCreatedNotesResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveCreatedNotesResult.errorMessage),
      };
    }

    const filePaths = resolveCreatedNotesResult.filePaths;

    if (filePaths.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const revertResult = await this.executeRevert({
      title,
      filePaths,
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
      command: 'revert_create',
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

    // Remove the artifact if revert was successful and artifactId was provided
    if (toolCall.args.artifactId && revertResult.revertedFiles.length > 0) {
      await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .removeArtifact(toolCall.args.artifactId, toolCall.args.explanation);
    }

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveCreatedNotes(params: {
    title: string;
    toolCall: ToolInvocation<unknown, RevertCreateToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ filePaths: string[]; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!toolCall.args.artifactId) {
      const message = t('common.noRecentOperations') || 'No artifact ID provided.';
      return { filePaths: [], errorMessage: message };
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.args.artifactId);

    if (!artifact) {
      logger.error(`Revert create tool artifact not found: ${toolCall.args.artifactId}`);
      const message = t('common.noRecentOperations') || 'No recent operations found.';
      return { filePaths: [], errorMessage: message };
    }

    if (artifact.artifactType !== ArtifactType.CREATED_NOTES) {
      const message = t('common.cannotRevertThisType', { type: artifact.artifactType });

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        agent: 'revert',
        command: 'revert_create',
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

      return { filePaths: [], errorMessage: message };
    }

    // Extract file paths from the artifact
    // To revert creation, we need to delete the created files
    return { filePaths: artifact.paths };
  }

  private async executeRevert(params: {
    title: string;
    filePaths: string[];
  }): Promise<RevertCreateExecutionResult> {
    const { filePaths } = params;
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const filePath of filePaths) {
      const result = await this.revertFileCreation({ filePath });
      if (!result.success) {
        failedFiles.push(filePath);
        continue;
      }

      revertedFiles.push(filePath);
    }

    return {
      revertedFiles,
      failedFiles,
    };
  }

  private async revertFileCreation(params: { filePath: string }): Promise<{ success: boolean }> {
    const { filePath } = params;

    const file = this.agent.app.vault.getFileByPath(filePath);

    if (!file) {
      logger.warn(`File not found for revert create: ${filePath}`);
      // Consider it successful if the file doesn't exist (already deleted)
      return { success: true };
    }

    try {
      // Delete the file to revert its creation
      await this.agent.app.vault.delete(file);

      return {
        success: true,
      };
    } catch (error) {
      logger.error(`Error reverting creation of ${filePath}:`, error);
      return { success: false };
    }
  }

  private async serializeRevertInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, RevertCreateToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'revert',
      command: 'revert_create',
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
