import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import type { TFile } from 'obsidian';
import { AbortService } from 'src/services/AbortService';
import { ToolCallPart } from '../../tools/types';
import { tool } from 'ai';

type PDFPageContent = unknown;

/**
 * Queue item type definition
 */
type QueueItem =
  | { type: 'file'; file: TFile }
  | { type: 'pdf-page'; file: TFile; page: PDFPageContent; folderId: number };

// BUILD_SEARCH_INDEX tool schema
const buildSearchIndexSchema = z.object({
  folders: z
    .array(z.string())
    .optional()
    .describe(
      'Optional array of folder paths to limit indexing. If provided, only files within these folders will be indexed.'
    ),
});

export type BuildSearchIndexArgs = z.infer<typeof buildSearchIndexSchema>;

export class BuildSearchIndex {
  private static readonly buildSearchIndexTool = tool({ inputSchema: buildSearchIndexSchema });
  constructor(private readonly agent: SuperAgent) {}

  public static getBuildSearchIndexTool() {
    return BuildSearchIndex.buildSearchIndexTool;
  }

  /**
   * Handle build search index tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<BuildSearchIndexArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('BuildSearchIndex.handle invoked without handlerId');
    }

    try {
      const t = getTranslation(lang);

      let files: TFile[];

      // If folders are specified, collect files from those folders only
      if (toolCall.input.folders && toolCall.input.folders.length > 0) {
        files = [];
        for (const folderPath of toolCall.input.folders) {
          const trimmedPath = folderPath.trim();
          if (!trimmedPath) {
            continue;
          }

          const folder = this.agent.app.vault.getFolderByPath(trimmedPath);
          if (!folder) {
            logger.warn(`Folder not found: ${trimmedPath}`);
            continue;
          }

          // Get all files from folder recursively
          const folderFiles = this.agent.obsidianAPITools.getFilesFromFolder(folder);
          files.push(...folderFiles);
        }
      } else {
        // No folders specified, get all files from vault
        files = this.agent.plugin.app.vault.getFiles();
      }

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

    const totalItemsToProcess = queue.length;

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
            // Normal file processing
            await this.agent.plugin.searchService.indexer.indexFile(item.file);

            indexedFiles.push(item.file.path);

            processedCount++;
          }

          // Update progress every 10 items
          if (processedCount % 10 === 0 || queue.length === 0) {
            let completionMessage = `**${t('search.indexedItems')}:**\n`;
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
          const filePath = item.file.path;
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
        completionMessage += `\n**${t('search.failedItems')}:**\n`;
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
