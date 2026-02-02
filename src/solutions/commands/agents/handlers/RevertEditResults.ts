import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType, Change, FileChangeSet } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { logger } from 'src/utils/logger';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { SysError } from 'src/utils/errors';
import { getCdnLib } from 'src/utils/cdnUrls';

const revertEditResultsToolSchema = z.object({
  artifactId: z
    .string()
    .min(1)
    .describe('The artifact identifier containing edit results to revert.'),
  explanation: z
    .string()
    .min(1)
    .describe('A short explanation of why these edit results should be reverted.'),
});

export type RevertEditResultsToolArgs = z.infer<typeof revertEditResultsToolSchema>;

type RevertEditResultsExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

export class RevertEditResults {
  constructor(private readonly agent: SuperAgent) {}

  public static async getRevertEditResultsTool() {
    const { tool } = await getCdnLib('ai');
    return tool({ inputSchema: revertEditResultsToolSchema });
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<RevertEditResultsToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new SysError('RevertEditResults.handle invoked without handlerId');
    }

    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'revert_edit_results',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const resolveFileChangeSetsResult = await this.resolveFileChangeSets({
      title,
      toolCall,
      lang,
      handlerId,
    });

    if (resolveFileChangeSetsResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveFileChangeSetsResult.errorMessage),
      };
    }

    const fileChangeSets = resolveFileChangeSetsResult.fileChangeSets;

    if (fileChangeSets.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const revertResult = await this.executeRevert({
      title,
      fileChangeSets,
    });

    let response = '';

    if (revertResult.revertedFiles.length > 0) {
      response = `**${t('revert.successfullyReverted', {
        count: revertResult.revertedFiles.length,
      })}**`;
      for (const path of revertResult.revertedFiles) {
        response += `\n- [[${path}]]`;
      }
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
      command: 'revert_edit_results',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      command: 'revert_edit_results',
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

  private async resolveFileChangeSets(params: {
    title: string;
    toolCall: ToolCallPart<RevertEditResultsToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ fileChangeSets: FileChangeSet[]; errorMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!toolCall.input.artifactId) {
      const message = t('common.noRecentOperations');
      return { fileChangeSets: [], errorMessage: message };
    }

    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getArtifactById(toolCall.input.artifactId);

    if (!artifact) {
      logger.error(`Revert edit results tool artifact not found: ${toolCall.input.artifactId}`);
      const message = t('common.noRecentOperations');
      return { fileChangeSets: [], errorMessage: message };
    }

    if (artifact.artifactType !== ArtifactType.EDIT_RESULTS) {
      const message = t('common.cannotRevertThisType', { type: artifact.artifactType });

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        command: 'revert_edit_results',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        command: 'revert_edit_results',
        title,
        handlerId,
        toolCall,
        result: {
          type: 'text',
          value: messageId ? `messageRef:${messageId}` : message,
        },
      });

      return { fileChangeSets: [], errorMessage: message };
    }

    // Extract file change sets from the artifact
    // To revert, we need to apply changes in reverse (swap originalContent and newContent)
    return { fileChangeSets: artifact.files };
  }

  private async executeRevert(params: {
    title: string;
    fileChangeSets: FileChangeSet[];
  }): Promise<RevertEditResultsExecutionResult> {
    const { fileChangeSets } = params;
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const fileChangeSet of fileChangeSets) {
      const result = await this.revertFileChanges({
        fileChangeSet,
      });
      if (!result.success) {
        failedFiles.push(fileChangeSet.path);
        continue;
      }

      revertedFiles.push(fileChangeSet.path);
    }

    return {
      revertedFiles,
      failedFiles,
    };
  }

  private async revertFileChanges(params: {
    fileChangeSet: FileChangeSet;
  }): Promise<{ success: boolean }> {
    const { fileChangeSet } = params;
    const { path, changes } = fileChangeSet;

    const file = this.agent.app.vault.getFileByPath(path);

    if (!file) {
      logger.error(`File not found for revert edit results: ${path}`);
      return { success: false };
    }

    try {
      // Read current content and apply changes in reverse order
      await this.agent.app.vault.process(file, currentContent => {
        let revertedContent = currentContent;

        // Apply changes in reverse order to avoid line number shifts
        // Reverse the changes array so we process from last to first
        const reversedChanges = [...changes].reverse();

        for (const change of reversedChanges) {
          // Process the change if it has content to revert
          // - Deletion: originalContent exists, newContent is empty
          // - Insertion: newContent exists, originalContent is empty
          // - Replacement: both exist
          if (change.originalContent !== undefined || change.newContent) {
            revertedContent = this.applyRevertChange(revertedContent, change);
          }
        }

        return revertedContent;
      });

      return {
        success: true,
      };
    } catch (error) {
      logger.error(`Error reverting edit results for ${path}:`, error);
      return { success: false };
    }
  }

  /**
   * Apply a single change in reverse (revert it)
   * Replaces newContent with originalContent in the current content
   */
  private applyRevertChange(content: string, change: Change): string {
    // Handle different change types based on what content exists

    if (!change.newContent) {
      // If newContent is empty, this was a deletion - restore originalContent
      if (change.originalContent) {
        // Try to insert originalContent back using context or line numbers
        return this.insertContentAtPosition(content, change);
      }
      return content;
    }

    if (!change.originalContent) {
      // If originalContent is empty, this was an insertion - remove newContent
      return this.removeContent(content, change);
    }

    // Both exist - this was a replacement
    // Replace newContent with originalContent using context-aware matching
    return this.replaceContent(content, change);
  }

  /**
   * Insert content back into the file (revert a deletion)
   */
  private insertContentAtPosition(content: string, change: Change): string {
    if (!change.originalContent) {
      return content;
    }

    const lines = content.split('\n');
    const originalLines = change.originalContent.split('\n');

    // Use startLine as a hint, but try to find exact position using context
    if (change.contextBefore) {
      // Try to find the insertion point using context
      const beforeContext = change.contextBefore.trim();
      const beforeLines = beforeContext.split('\n');
      const lastBeforeLine = beforeLines[beforeLines.length - 1];

      // Find the line containing the context
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(lastBeforeLine)) {
          // Insert after this line
          lines.splice(i + 1, 0, ...originalLines);
          return lines.join('\n');
        }
      }
    }

    // Fallback: use startLine
    const insertPosition = Math.min(Math.max(0, change.startLine), lines.length);
    lines.splice(insertPosition, 0, ...originalLines);
    return lines.join('\n');
  }

  /**
   * Remove content from the file (revert an insertion)
   */
  private removeContent(content: string, change: Change): string {
    // Use context to find the exact location if available
    if (change.contextBefore || change.contextAfter) {
      const beforeContext = (change.contextBefore || '').trim();
      const afterContext = (change.contextAfter || '').trim();
      const newContent = change.newContent.trim();

      // Build a pattern that includes context
      let pattern: string;
      if (beforeContext && afterContext) {
        pattern = `${this.escapeRegex(beforeContext)}\\s*${this.escapeRegex(newContent)}\\s*${this.escapeRegex(afterContext)}`;
      } else if (beforeContext) {
        pattern = `${this.escapeRegex(beforeContext)}\\s*${this.escapeRegex(newContent)}`;
      } else if (afterContext) {
        pattern = `${this.escapeRegex(newContent)}\\s*${this.escapeRegex(afterContext)}`;
      } else {
        pattern = this.escapeRegex(newContent);
      }

      const regex = new RegExp(pattern, 's');
      if (regex.test(content)) {
        // Replace with just the context (removing newContent)
        if (beforeContext && afterContext) {
          return content.replace(regex, `${beforeContext}\n${afterContext}`);
        } else if (beforeContext) {
          return content.replace(regex, beforeContext);
        } else if (afterContext) {
          return content.replace(regex, afterContext);
        } else {
          return content.replace(regex, '');
        }
      }
    }

    // Fallback: simple removal (replace first occurrence)
    // Match the content with optional newlines before and after
    // Replace with a single newline if both newlines were present, otherwise empty string
    const newContent = change.newContent;
    const escapedContent = this.escapeRegex(newContent);
    // Match: optional newline + content + optional newline
    const pattern = `(\n?)${escapedContent}(\n?)`;
    const regex = new RegExp(pattern);
    return content.replace(regex, (match, newlineBefore, newlineAfter) => {
      // If both newlines exist, keep one; if only one exists, remove it; if neither, keep empty
      if (newlineBefore && newlineAfter) {
        return '\n'; // Both newlines present, keep one
      }
      return ''; // One or no newlines, remove all
    });
  }

  /**
   * Replace content in the file (revert a replacement)
   */
  private replaceContent(content: string, change: Change): string {
    // Use context to make the replacement more precise
    if (change.contextBefore || change.contextAfter) {
      const beforeContext = (change.contextBefore || '').trim();
      const afterContext = (change.contextAfter || '').trim();
      const newContent = change.newContent.trim();
      const originalContent = change.originalContent.trim();

      // Build a pattern that includes context
      let pattern: string;
      if (beforeContext && afterContext) {
        pattern = `${this.escapeRegex(beforeContext)}\\s*${this.escapeRegex(newContent)}\\s*${this.escapeRegex(afterContext)}`;
      } else if (beforeContext) {
        pattern = `${this.escapeRegex(beforeContext)}\\s*${this.escapeRegex(newContent)}`;
      } else if (afterContext) {
        pattern = `${this.escapeRegex(newContent)}\\s*${this.escapeRegex(afterContext)}`;
      } else {
        pattern = this.escapeRegex(newContent);
      }

      const regex = new RegExp(pattern, 's');
      if (regex.test(content)) {
        // Replace with originalContent, preserving context
        if (beforeContext && afterContext) {
          return content.replace(regex, `${beforeContext}\n${originalContent}\n${afterContext}`);
        } else if (beforeContext) {
          return content.replace(regex, `${beforeContext}\n${originalContent}`);
        } else if (afterContext) {
          return content.replace(regex, `${originalContent}\n${afterContext}`);
        } else {
          return content.replace(regex, originalContent);
        }
      }
    }

    // Fallback: simple replacement (replace first occurrence)
    // This may have issues with multiple identical occurrences
    return content.replace(change.newContent, change.originalContent);
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
