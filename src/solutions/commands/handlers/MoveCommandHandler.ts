import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { extractMoveQuery, MoveExtraction } from 'src/lib/modelfusion';
import { Artifact, ArtifactType } from 'src/solutions/artifact';
import { getTranslation } from 'src/i18n';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events } from 'src/types/events';
import { MediaTools } from 'src/tools/mediaTools';
import type StewardPlugin from 'src/main';
import { DocWithPath } from 'src/types/types';

export class MoveCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the move command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.moving'));
  }

  /**
   * Handle a move command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      extraction?: MoveExtraction;
      folderExistsConfirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, prevCommand, lang } = params;
    const t = getTranslation(lang);

    // Check the search result of the previous command
    if (prevCommand && prevCommand.commandType === 'search') {
      const artifact = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactByType(ArtifactType.SEARCH_RESULTS);

      if (artifact && artifact.originalResults.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('move.noSearchResultsFoundAbortMove')}*`,
        });

        return {
          status: CommandResultStatus.SUCCESS,
        };
      }
    }

    try {
      // Extract move details from command content
      const extraction = options.extraction || (await extractMoveQuery(command));

      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        role: 'Steward',
        includeHistory: false,
      });

      if (extraction.confidence <= 0.7) {
        // Return LOW_CONFIDENCE status to trigger context augmentation
        return {
          status: CommandResultStatus.LOW_CONFIDENCE,
          commandType: 'move_from_artifact',
          explanation: extraction.explanation,
        };
      }

      let docs: DocWithPath[] = [];
      let artifact: Artifact | undefined;

      if (extraction.context === 'artifact') {
        // Get the most recent artifact
        artifact = await this.plugin.artifactManagerV2
          .withTitle(title)
          .getMostRecentArtifactOfTypes([
            ArtifactType.SEARCH_RESULTS,
            ArtifactType.CREATED_NOTES,
            ArtifactType.READ_CONTENT,
          ]);

        if (!artifact) {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: t('common.noRecentOperations'),
          });

          return {
            status: CommandResultStatus.ERROR,
            error: new Error('No recent operations found'),
          };
        }

        if (artifact.artifactType === ArtifactType.SEARCH_RESULTS) {
          docs = artifact.originalResults.map(result => ({ path: result.document.path }));
        } else if (artifact.artifactType === ArtifactType.CREATED_NOTES) {
          // Convert string paths to IndexedDocument objects
          docs = artifact.paths.map(path => ({ path }));
        } else if (artifact.artifactType === ArtifactType.READ_CONTENT) {
          // For read content, get the file from the reading result
          const file = artifact.readingResult.file;
          docs = file ? [{ path: file.path }] : [];
        } else {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: `*${t('move.cannotMoveThisType', { type: artifact.artifactType })}*`,
          });

          return {
            status: CommandResultStatus.ERROR,
            error: new Error('Cannot move this type of artifact'),
          };
        }
      } else if (extraction.context === 'currentNote') {
        const activeFile = this.app.workspace.getActiveFile();
        docs = activeFile ? [{ path: activeFile.path }] : [];
      } else {
        const noteName = extraction.context;
        const note = await MediaTools.getInstance(this.app).findFileByNameOrPath(noteName);
        docs = note ? [{ path: note.path }] : [];
      }

      // Check if docs were found
      if (docs.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.noFilesFound'),
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No files found to move'),
        };
      }

      // Check if the destination folder exists
      const destinationFolder = extraction.destinationFolder;
      const folderExists = this.app.vault.getFolderByPath(destinationFolder);

      if (!folderExists && !options.folderExistsConfirmed && !command.no_confirm) {
        // Request confirmation to create the folder
        let message = t('move.createFoldersHeader') + '\n';
        message += `- \`${destinationFolder}\`\n`;
        message += '\n' + t('move.createFoldersQuestion');

        await this.renderer.updateConversationNote({
          path: title,
          newContent: message,
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.handle(params, { extraction, folderExistsConfirmed: true });
          },
          onRejection: () => {
            return {
              status: CommandResultStatus.SUCCESS,
            };
          },
        };
      }

      return this.performMoveOperation(
        title,
        {
          destinationFolder,
          docs,
          explanation: extraction.explanation,
        },
        lang
      );
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error processing move command: ${error.message}`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Perform the actual move operation
   */
  private async performMoveOperation(
    title: string,
    context: {
      destinationFolder: string;
      docs: DocWithPath[];
      explanation: string;
    },
    lang?: string | null
  ): Promise<CommandResult> {
    try {
      const { destinationFolder, docs, explanation } = context;

      // Create operations array for the move
      const operations = [
        {
          keywords: [explanation],
          filenames: [],
          folders: [],
          properties: [],
          destinationFolder,
        },
      ];

      // Set the files for this operation
      const filesByOperation = new Map<number, DocWithPath[]>();
      filesByOperation.set(0, docs);

      // Perform the move operations
      const result = await this.obsidianAPITools.moveByOperations(operations, filesByOperation);

      // Delete the most recent artifact (if any) after moving
      // const artifact = this.plugin.artifactManagerV2.withTitle(title).getMostRecentArtifact(title);
      // if (artifact && artifact.id) {
      //   if (this.artifactManager.deleteArtifact(title, artifact.id)) {
      //     logger.log(
      //       `Artifact of type ${artifact.type} deleted successfully (created ${new Date(artifact.createdAt).toLocaleString()}).`
      //     );
      //   }
      // }

      // Format the results
      const response = this.formatMoveResult({
        operations: result.operations,
        lang,
      });

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response,
        command: 'move',
      });

      // Emit the move operation completed event
      eventEmitter.emit(Events.MOVE_OPERATION_COMPLETED, {
        title,
        operations: result.operations,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error moving files: ${error.message}`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Format move results for display
   */
  private formatMoveResult(result: {
    operations: Array<{
      sourceQuery: string;
      destinationFolder: string;
      moved: string[];
      errors: string[];
      skipped: string[];
    }>;
    lang?: string | null;
  }): string {
    const { operations, lang } = result;

    // Get translation function for the specified language
    const t = getTranslation(lang);

    // Single operation format
    if (operations.length === 1) {
      const { moved, errors, skipped } = operations[0];
      const totalCount = moved.length + errors.length + skipped.length;

      let response = t('move.foundFiles', { count: totalCount });

      if (moved.length > 0) {
        response += `\n\n**${t('move.successfullyMoved', { count: moved.length })}**`;
        moved.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (skipped.length > 0) {
        response += `\n\n**${t('move.skipped', { count: skipped.length })}**`;
        skipped.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (errors.length > 0) {
        response += `\n\n**${t('move.failed', { count: errors.length })}**`;
        errors.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      return response;
    }

    // Multiple operations format
    let response = t('move.multiMoveHeader', { count: operations.length });

    // For each operation, show the details
    operations.forEach((operation, index) => {
      const { sourceQuery, destinationFolder, moved, errors, skipped } = operation;
      const totalCount = moved.length + errors.length + skipped.length;

      response += `\n\n**${t('move.operation', {
        num: index + 1,
        query: sourceQuery,
        folder: destinationFolder,
      })}**`;

      if (totalCount === 0) {
        response += `\n\n${t('search.noResults')}`;
        return;
      }

      if (moved.length > 0) {
        response += `\n\n**${t('move.successfullyMoved', { count: moved.length })}**`;
        moved.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (skipped.length > 0) {
        response += `\n\n**${t('move.skipped', { count: skipped.length })}**`;
        skipped.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (errors.length > 0) {
        response += `\n\n**${t('move.failed', { count: errors.length })}**`;
        errors.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }
    });

    return response;
  }
}
