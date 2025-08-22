import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import type { TFile } from 'obsidian';
import { AbortService } from 'src/services/AbortService';

export class BuildSearchIndexCommandHandler extends CommandHandler {
  isContentRequired = false;

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.buildingIndex'));
  }

  /**
   * Handle the build search index command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, lang } = params;

    try {
      const t = getTranslation(lang);

      const files = await this.plugin.searchService.documentStore.getAllFiles();
      const validFiles = files.filter(
        file => !this.plugin.searchService.documentStore.isExcluded(file.path)
      );

      if (validFiles.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('search.noFilesToIndex'),
          command: 'build_search_index',
          lang,
        });
        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

      // Show found files message and privacy notice for all scenarios
      await this.renderer.updateConversationNote({
        path: title,
        newContent:
          t('search.foundFilesForIndex', { count: validFiles.length }) +
          '\n\n' +
          `*${t('search.privacyNotice')}*`,
        command: 'build_search_index',
        lang,
      });

      // Check if index already exists to determine if we need confirmation
      const isIndexBuilt = await this.plugin.searchService.documentStore.isIndexBuilt();

      if (isIndexBuilt) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `\n${t('search.confirmRebuildIndexQuestion')}`,
          command: 'build_search_index',
          lang,
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.performIndexing(title, validFiles, lang);
          },
          onRejection: () => {
            return {
              status: CommandResultStatus.SUCCESS,
            };
          },
        };
      }

      // Index doesn't exist, run indexing directly without confirmation
      return this.performIndexing(title, validFiles, lang);
    } catch (error) {
      logger.error('Error in build search index command:', error);

      const t = getTranslation(lang);
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('search.indexingError', { error: error.message })}*`,
        command: 'build_search_index',
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
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
    lang?: string
  ): Promise<CommandResult> {
    const abortService = AbortService.getInstance();
    const operationId = 'build_search_index';
    const abortSignal = abortService.createAbortController(operationId);

    const t = getTranslation(lang);

    // Build the index by processing each file directly
    const indexedFiles: string[] = [];
    const failedFiles: string[] = [];

    try {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('search.buildingIndex'),
        command: 'build_search_index',
        lang,
      });

      let prevMessageId = '';
      for (const file of validFiles) {
        // Check if operation was aborted
        if (abortSignal.aborted) {
          return {
            status: CommandResultStatus.SUCCESS,
          };
        }

        try {
          // Use the indexer's indexFile method directly
          await this.plugin.searchService.indexer.indexFile(file);
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
            const messageId = await this.renderer.updateConversationNote({
              path: title,
              newContent:
                completionMessage +
                '\n\n' +
                t('search.indexingProgress', {
                  completed: indexedFiles.length,
                  total: validFiles.length,
                }),
              command: 'build_search_index',
              messageId: prevMessageId,
              includeHistory: false,
              lang,
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

      await this.renderer.updateConversationNote({
        path: title,
        newContent: completionMessage,
        command: 'build_search_index',
        lang,
      });

      // Set the index as built after successful indexing
      this.plugin.searchService.indexer.setIndexBuilt(true);

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error building search index:', error);

      const t = getTranslation(lang);
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('search.indexingError', { error: error.message })}*`,
        role: 'Steward',
        command: 'build_search_index',
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    } finally {
      // Always clean up the abort controller
      abortService.abortOperation(operationId);
    }
  }
}
