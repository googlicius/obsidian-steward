import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type RevertAgent from './RevertAgent';
import { logger } from 'src/utils/logger';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

const revertFrontmatterToolSchema = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe('The artifact identifier containing frontmatter updates to revert.'),
  explanation: z
    .string()
    .min(1)
    .describe('A short explanation of why these frontmatter updates should be reverted.'),
});

export type RevertFrontmatterToolArgs = z.infer<typeof revertFrontmatterToolSchema>;

type RevertFrontmatterExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

export class RevertFrontmatter {
  private static readonly revertFrontmatterTool = tool({ parameters: revertFrontmatterToolSchema });

  constructor(private readonly agent: RevertAgent) {}

  public static getRevertFrontmatterTool() {
    return RevertFrontmatter.revertFrontmatterTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, RevertFrontmatterToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('RevertFrontmatter.handle invoked without handlerId');
    }

    if (toolCall.args.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        agent: 'revert',
        command: 'revert_frontmatter',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveUpdatesResult = await this.resolveUpdates({
      title,
      toolCall,
      lang,
      handlerId,
    });

    if (resolveUpdatesResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveUpdatesResult.errorMessage),
      };
    }

    const updates = resolveUpdatesResult.updates;

    if (updates.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const revertResult = await this.executeRevert({
      title,
      updates,
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
      command: 'revert_frontmatter',
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

  private async resolveUpdates(params: {
    title: string;
    toolCall: ToolInvocation<unknown, RevertFrontmatterToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{
    updates: Array<{
      path: string;
      original: Record<string, unknown>;
      updated: Record<string, unknown>;
    }>;
    errorMessage?: string;
  }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!toolCall.args.artifactId) {
      const message = t('common.noRecentOperations') || 'No artifact ID provided.';
      return { updates: [], errorMessage: message };
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.args.artifactId);

    if (!artifact) {
      logger.error(`Revert frontmatter tool artifact not found: ${toolCall.args.artifactId}`);
      const message = t('common.noRecentOperations') || 'No recent operations found.';
      return { updates: [], errorMessage: message };
    }

    if (artifact.artifactType !== ArtifactType.UPDATE_FRONTMATTER_RESULTS) {
      const message =
        t('common.cannotRevertThisType', { type: artifact.artifactType }) ||
        `Cannot revert this type of artifact: ${artifact.artifactType}`;

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        agent: 'revert',
        command: 'revert_frontmatter',
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

      return { updates: [], errorMessage: message };
    }

    // Extract updates from the artifact
    // Each update has original and updated frontmatter
    // To revert, we need to restore the original frontmatter
    return { updates: artifact.updates };
  }

  private async executeRevert(params: {
    title: string;
    updates: Array<{
      path: string;
      original: Record<string, unknown>;
      updated: Record<string, unknown>;
    }>;
  }): Promise<RevertFrontmatterExecutionResult> {
    const { updates } = params;
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const update of updates) {
      const result = await this.revertFileFrontmatter({
        path: update.path,
        original: update.original,
      });
      if (!result.success) {
        failedFiles.push(update.path);
        continue;
      }

      revertedFiles.push(update.path);
    }

    return {
      revertedFiles,
      failedFiles,
    };
  }

  private async revertFileFrontmatter(params: {
    path: string;
    original: Record<string, unknown>;
  }): Promise<{ success: boolean }> {
    const { path, original } = params;

    const file = this.agent.app.vault.getFileByPath(path);

    if (!file) {
      logger.error(`File not found for revert frontmatter: ${path}`);
      return { success: false };
    }

    try {
      // Restore the original frontmatter
      await this.agent.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          // Clear current frontmatter
          Object.keys(frontmatter).forEach(key => {
            delete frontmatter[key];
          });

          // Restore original frontmatter
          Object.assign(frontmatter, original);
        }
      );

      return {
        success: true,
      };
    } catch (error) {
      logger.error(`Error reverting frontmatter for ${path}:`, error);
      return { success: false };
    }
  }

  private async serializeRevertInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, RevertFrontmatterToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'revert',
      command: 'revert_frontmatter',
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
