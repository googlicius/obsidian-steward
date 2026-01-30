import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import type { TFile } from 'obsidian';
import { AbortService } from 'src/services/AbortService';
import type { PDFPageContent } from 'src/solutions/search/binaryContent/types';

/**
 * Queue item type definition
 */
type QueueItem =
  | { type: 'file'; file: TFile }
  | { type: 'pdf-page'; file: TFile; page: PDFPageContent; folderId: number };

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
      const queue: QueueItem[] = files
        .filter(file => !this.agent.plugin.searchService.documentStore.isExcluded(file.path))
        .map(file => ({ type: 'file', file }));

      if (queue.length === 0) {
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
          t('search.foundFilesForIndex', { count: queue.length }) +
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
          includeHistory: false,
        });

        return {
          status: IntentResultStatus.NEEDS_CONFIRMATION,
          confirmationMessage: t('search.confirmRebuildIndexQuestion'),
          onConfirmation: () => {
            return this.performIndexing(title, queue, lang, handlerId);
          },
          onRejection: () => {
            return {
              status: IntentResultStatus.STOP_PROCESSING,
            };
          },
        };
      }

      // Index doesn't exist, run indexing directly without confirmation
      return this.performIndexing(title, queue, lang, handlerId);
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
    queue: QueueItem[],
    lang: string | null | undefined,
    handlerId: string
  ): Promise<AgentResult> {
    const abortService = AbortService.getInstance();
    const operationId = 'build_search_index';
    const abortSignal = abortService.createAbortController(operationId);

    const t = getTranslation(lang);

    let totalItemsToProcess = queue.length;

    // Track progress
    const indexedFiles: string[] = [];
    const failedFiles: string[] = [];
    let processedCount = 0;

    try {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: t('search.buildingIndex'),
        lang,
        handlerId,
      });

      let prevMessageId = '';

      // Process the queue
      while (queue.length > 0) {
        // Check if operation was aborted
        if (abortSignal.aborted) {
          return {
            status: IntentResultStatus.STOP_PROCESSING,
          };
        }

        const item = queue.shift();
        if (!item) break;

        try {
          if (item.type === 'file') {
            // Handle PDF files by expanding them into pages
            if (item.file.extension === 'pdf') {
              try {
                const extraction = await this.agent.plugin.pdfExtractor.extractText(item.file);

                if (extraction && extraction.pages.length > 0) {
                  // Get folder ID for the PDF file
                  const folderPath = item.file.path.substring(0, item.file.path.lastIndexOf('/'));
                  const folderName = folderPath.split('/').pop() || '';
                  const folderId = await this.agent.plugin.searchService.indexer.indexFolder(
                    folderPath,
                    folderName
                  );

                  // Create page items
                  const pageItems: QueueItem[] = extraction.pages.map(page => ({
                    type: 'pdf-page',
                    file: item.file,
                    page,
                    folderId,
                  }));

                  // Add pages to the BEGINNING of the queue to process them next
                  queue.unshift(...pageItems);

                  if (extraction.pages.length > 0) {
                    totalItemsToProcess += extraction.pages.length - 1;
                  } else {
                    totalItemsToProcess -= 1; // It was 1 file, now 0 pages.
                  }
                }
              } catch (e) {
                logger.error(`Error extracting PDF text for ${item.file.path}:`, e);
                failedFiles.push(item.file.path);
                processedCount++; // Failed but processed
                continue;
              }
            }

            // Normal file processing
            const docsIndexed = await this.agent.plugin.searchService.indexer.indexFile(item.file, {
              pdfPages: false,
            });

            if (docsIndexed > 0) {
              indexedFiles.push(item.file.path);
            }

            processedCount++;
          } else if (item.type === 'pdf-page') {
            // Process PDF page
            await this.agent.plugin.searchService.indexer.indexPDFPage(
              item.file,
              item.page,
              item.folderId
            );

            indexedFiles.push(`${item.file.path} (Page ${item.page.pageNumber})`);
            processedCount++;
          }

          // Update progress every 10 items
          if (processedCount % 10 === 0 || queue.length === 0) {
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
                  completed: processedCount,
                  total: totalItemsToProcess,
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
          const filePath =
            item.type === 'file'
              ? item.file.path
              : `${item.file.path}#page=${item.page.pageNumber}`;
          logger.error(`Error indexing ${filePath}:`, error);
          if (item.type === 'file') {
            failedFiles.push(item.file.path);
          }
          processedCount++;
        }
      }

      let completionMessage = `**${t('search.indexingCompleted', {
        count: indexedFiles.length,
        total: totalItemsToProcess,
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
