import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { Events } from 'src/types/events';
import { eventEmitter } from 'src/services/EventEmitter';
import {
  DestinationFolderExtraction,
  extractDestinationFolder,
} from 'src/lib/modelfusion/extractions';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { MoveOperationV2 } from 'src/tools/obsidianAPITools';

import type StewardPlugin from 'src/main';

export class CopyCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the copy command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.copying'));
  }

  /**
   * Handle a copy command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      extraction?: DestinationFolderExtraction;
      folderExistsConfirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, prevCommand, lang } = params;
    const t = getTranslation(lang);

    // Check the search result of the previous command
    if (prevCommand && prevCommand.commandType === 'search') {
      const artifact = this.artifactManager.getMostRecentArtifact(title);

      if (artifact && artifact.type === ArtifactType.SEARCH_RESULTS) {
        if (artifact.originalResults.length === 0) {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: `*${t('copy.noSearchResultsFoundAbortCopy')}*`,
            lang,
          });

          return {
            status: CommandResultStatus.SUCCESS,
          };
        }
      }
    }

    try {
      // Retrieve the most recent artifact regardless of type
      const artifact = this.artifactManager.getMostRecentArtifact(title);

      if (!artifact) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.noRecentOperations'),
          role: 'Steward',
          lang,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No recent operations found'),
        };
      }

      // Handle different artifact types
      let docs: any[] = [];

      if (artifact.type === ArtifactType.SEARCH_RESULTS) {
        docs = artifact.originalResults;
      } else if (artifact.type === ArtifactType.CREATED_NOTES) {
        docs = artifact.paths.map(path => ({ path }));
      } else {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.cannotCopyThisType'),
          role: 'Steward',
          lang,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Cannot copy this type of artifact'),
        };
      }

      // If no files match, inform the user
      if (docs.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.noFilesFound'),
          role: 'Steward',
          command: 'copy',
          lang,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No files found to copy'),
        };
      }

      const extraction = options.extraction || (await extractDestinationFolder(command));

      // Convert search operations to move operations for copying
      const copyOperations: MoveOperationV2[] = [
        {
          keywords: [extraction.explanation],
          tags: [],
          filenames: [],
          folders: [],
          destinationFolder: extraction.destinationFolder,
        },
      ];

      const folderExists = this.app.vault.getAbstractFileByPath(extraction.destinationFolder);

      if (!folderExists && !options.folderExistsConfirmed) {
        // Request confirmation to create the folder
        let message = t('copy.createFoldersHeader') + '\n';
        message += `- \`${extraction.destinationFolder}\`\n`;
        message += '\n' + t('copy.createFoldersQuestion');

        await this.renderer.updateConversationNote({
          path: title,
          newContent: message,
          role: 'Steward',
          lang,
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          confirmationMessage: message,
          onConfirmation: () => {
            return this.handle(params, { extraction, folderExistsConfirmed: true });
          },
          onRejection: () => {
            this.artifactManager.deleteArtifact(title, artifact.id);
            return {
              status: CommandResultStatus.SUCCESS,
            };
          },
        };
      }

      // Folder exists, perform the copy operation
      return this.performCopyOperation(title, docs, copyOperations, extraction.lang);
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error copying files: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Perform the actual copy operation
   */
  private async performCopyOperation(
    title: string,
    docs: IndexedDocument[],
    moveOperations: MoveOperationV2[],
    lang?: string
  ): Promise<CommandResult> {
    try {
      // Create a map of files by operation
      const filesByOperation = new Map<number, IndexedDocument[]>();
      filesByOperation.set(0, docs);

      // Perform the copy operation
      const result = await this.obsidianAPITools.copyByOperations(moveOperations, filesByOperation);

      // Format the results
      const response = this.formatCopyResult({
        operations: result.operations,
        lang,
      });

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response,
        role: 'Steward',
        command: 'copy',
      });

      // Emit the copy operation completed event
      eventEmitter.emit(Events.COPY_OPERATION_COMPLETED, {
        title,
        operations: result.operations,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error copying files: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Format copy results for display
   */
  private formatCopyResult(result: {
    operations: Array<{
      sourceQuery: string;
      destinationFolder: string;
      copied: string[];
      errors: string[];
      skipped: string[];
    }>;
    lang?: string;
  }): string {
    const { operations, lang } = result;

    const t = getTranslation(lang);

    // Single operation format
    if (operations.length === 1) {
      const { copied, errors, skipped } = operations[0];
      const totalCount = copied.length + errors.length + skipped.length;

      let response = t('copy.foundFiles', { count: totalCount });

      if (copied.length > 0) {
        response += `\n\n**${t('copy.successfullyCopied', { count: copied.length })}**`;
        copied.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (skipped.length > 0) {
        response += `\n\n**${t('copy.skipped', { count: skipped.length })}**`;
        skipped.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (errors.length > 0) {
        response += `\n\n**${t('copy.failed', { count: errors.length })}**`;
        errors.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      return response;
    }

    // Multiple operations format
    let response = t('copy.multiCopyHeader', { count: operations.length });

    // For each operation, show the details
    operations.forEach((operation, index) => {
      const { sourceQuery, destinationFolder, copied, errors, skipped } = operation;
      const totalCount = copied.length + errors.length + skipped.length;

      response += `\n\n**${t('copy.operation', {
        num: index + 1,
        query: sourceQuery,
        folder: destinationFolder,
      })}**`;

      if (totalCount === 0) {
        response += `\n\n${t('search.noResults')}`;
        return;
      }

      if (copied.length > 0) {
        response += `\n\n**${t('copy.successfullyCopied', { count: copied.length })}**`;
        copied.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (skipped.length > 0) {
        response += `\n\n**${t('copy.skipped', { count: skipped.length })}**`;
        skipped.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (errors.length > 0) {
        response += `\n\n**${t('copy.failed', { count: errors.length })}**`;
        errors.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }
    });

    return response;
  }
}
