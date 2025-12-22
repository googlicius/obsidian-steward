import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import type { TFile } from 'obsidian';
import { AbortService } from 'src/services/AbortService';

// BUILD_SEARCH_INDEX tool doesn't need args
const buildSearchIndexSchema = z.object({});

export type BuildSearchIndexArgs = z.infer<typeof buildSearchIndexSchema>;

export class BuildSearchIndex {
  private static readonly buildSearchIndexTool = tool({
    inputSchema: buildSearchIndexSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getBuildSearchIndexTool() {
    return BuildSearchIndex.buildSearchIndexTool;
  }

  /**
   * Handle build search index tool call
   */
  public async handle(params: AgentHandlerParams): Promise<AgentResult> {
    const { title, lang, handlerId } = params;

    if (!handlerId) {
      throw new Error('BuildSearchIndex.handle invoked without handlerId');
    }

    try {
      const t = getTranslation(lang);

      const files = this.agent.plugin.app.vault.getFiles();
      const validFiles = files.filter(
        file => !this.agent.plugin.searchService.documentStore.isExcluded(file.path)
      );

      if (validFiles.length === 0) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('search.noFilesToIndex'),
          lang,
          handlerId,
        });

        return {
          status: IntentResultStatus.STOP_PROCESSING,
        };
      }

      // Show found files message and privacy notice for all scenarios
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent:
          t('search.foundFilesForIndex', { count: validFiles.length }) +
          '\n\n' +
          `*${t('search.privacyNotice')}*`,
        lang,
        handlerId,
      });

      // Check if index already exists to determine if we need confirmation
      const isIndexBuilt = await this.agent.plugin.searchService.documentStore.isIndexBuilt();

      if (isIndexBuilt) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: `\n${t('search.confirmRebuildIndexQuestion')}`,
          lang,
          handlerId,
        });

        return {
          status: IntentResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.performIndexing(title, validFiles, lang, handlerId);
          },
          onRejection: () => {
            return {
              status: IntentResultStatus.STOP_PROCESSING,
            };
          },
        };
      }

      // Index doesn't exist, run indexing directly without confirmation
      return this.performIndexing(title, validFiles, lang, handlerId);
    } catch (error) {
      logger.error('Error in build search index command:', error);

      const t = getTranslation(lang);
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('search.indexingError', { error: (error as Error).message })}*`,
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Perform the actual indexing operation
   */
  private async performIndexing(
    title: string,
    validFiles: TFile[],
    lang: string | null | undefined,
    handlerId: string
  ): Promise<AgentResult> {
    const abortService = AbortService.getInstance();
    const operationId = 'build_search_index';
    const abortSignal = abortService.createAbortController(operationId);

    const t = getTranslation(lang);

    // Build the index by processing each file directly
    const indexedFiles: string[] = [];
    const failedFiles: string[] = [];

    try {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: t('search.buildingIndex'),
        lang,
        handlerId,
      });

      let prevMessageId = '';
      for (const file of validFiles) {
        // Check if operation was aborted
        if (abortSignal.aborted) {
          return {
            status: IntentResultStatus.STOP_PROCESSING,
          };
        }

        try {
          // Use the indexer's indexFile method directly
          await this.agent.plugin.searchService.indexer.indexFile(file);
          indexedFiles.push(file.path);

          // Update progress every 10 files
          if (indexedFiles.length % 10 === 0) {
            let completionMessage = `**${t('search.indexedFiles')}:**\n`;
            if (indexedFiles.length > 0) {
              // Take only the last 12 indexed files
              const displayFiles = indexedFiles.slice(-12);
              for (let i = 0; i < displayFiles.length; i++) {
                completionMessage += `- ${displayFiles[i]}\n`;
              }
            }
            const messageId = await this.agent.renderer.updateConversationNote({
              path: title,
              newContent:
                completionMessage +
                '\n\n' +
                t('search.indexingProgress', {
                  completed: indexedFiles.length,
                  total: validFiles.length,
                }),
              messageId: prevMessageId,
              includeHistory: false,
              lang,
              handlerId,
            });

            if (messageId) {
              prevMessageId = messageId;
            }
          }
        } catch (error) {
          logger.error(`Error indexing file ${file.path}:`, error);
          failedFiles.push(file.path);
        }
      }

      let completionMessage = `**${t('search.indexingCompleted', {
        count: indexedFiles.length,
        total: validFiles.length,
      })}**\n`;

      if (failedFiles.length > 0) {
        completionMessage += `\n**${t('search.failedFiles')}:**\n`;
        failedFiles.forEach(filePath => {
          completionMessage += `- ${filePath}\n`;
        });
      }

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: completionMessage,
        lang,
        handlerId,
      });

      // Set the index as built after successful indexing
      this.agent.plugin.searchService.indexer.setIndexBuilt(true);

      return {
        status: IntentResultStatus.STOP_PROCESSING,
      };
    } catch (error) {
      logger.error('Error building search index:', error);

      const t = getTranslation(lang);
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('search.indexingError', { error: (error as Error).message })}*`,
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    } finally {
      // Always clean up the abort controller
      abortService.abortOperation(operationId);
    }
  }
}
