import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { DocWithPath } from 'src/types/types';

export class DeleteCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the delete command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.deleting'));
  }

  /**
   * Delete a file based on the delete behavior setting
   * @param filePath Path of the file to delete
   * @returns Object containing success status and trash path if applicable
   */
  private async trashFile(params: {
    filePath: string;
  }): Promise<{ success: boolean; trashPath?: string; originalPath: string }> {
    const { filePath } = params;

    try {
      if (this.plugin.settings.deleteBehavior.behavior === 'stw_trash') {
        const trashFolder = `${this.plugin.settings.stewardFolder}/Trash`;

        const file = this.app.vault.getFileByPath(filePath);
        if (!file) {
          return { success: false, originalPath: filePath };
        }

        const extension = file.extension ? `.${file.extension}` : '';
        const uniqueFileName = `${file.basename}_${Date.now()}${extension}`;

        await this.obsidianAPITools.ensureFolderExists(trashFolder);

        // Move file directly to trash with unique name
        const trashPath = `${trashFolder}/${uniqueFileName}`;

        try {
          await this.app.fileManager.renameFile(file, trashPath);

          return { success: true, trashPath, originalPath: filePath };
        } catch (error) {
          logger.error(`Error moving file to trash: ${error}`);
          return { success: false, originalPath: filePath };
        }
      } else {
        const file = this.app.vault.getFileByPath(filePath);
        if (!file) {
          return { success: false, originalPath: filePath };
        }
        await this.app.fileManager.trashFile(file);
        return { success: true, originalPath: filePath };
      }
    } catch (error) {
      logger.error(
        `Error deleting file ${filePath} with behavior ${this.plugin.settings.deleteBehavior.behavior}:`,
        error
      );
      return { success: false, originalPath: filePath };
    }
  }

  /**
   * Handle a delete command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, lang } = params;
    const t = getTranslation(lang);

    try {
      // Retrieve the most recent artifact regardless of type
      const artifact = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactOfTypes([ArtifactType.SEARCH_RESULTS, ArtifactType.CREATED_NOTES]);

      if (!artifact) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.noRecentOperations'),
          role: 'Steward',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No recent operations found'),
        };
      }

      // Handle different artifact types
      let docs: DocWithPath[] = [];

      if (artifact.artifactType === ArtifactType.SEARCH_RESULTS) {
        docs = artifact.originalResults.map(result => ({
          path: result.document.path,
        }));
      } else if (artifact.artifactType === ArtifactType.CREATED_NOTES) {
        docs = artifact.paths.map(path => ({ path }));
      } else {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.cannotDeleteThisType', { type: artifact.artifactType }),
          role: 'Steward',
        });
        logger.error('Cannot delete this artifact', artifact);

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Cannot delete this type of artifact'),
        };
      }

      // If no files match, inform the user
      if (docs.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.noFilesFound'),
          role: 'Steward',
          command: 'delete',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No files found to delete'),
        };
      }

      // Generate artifact ID for this delete operation
      const artifactId = `delete_${Date.now()}`;

      const isStwTrash = this.plugin.settings.deleteBehavior.behavior === 'stw_trash';

      type TrashFile = { originalPath: string; trashPath: string };
      type NonTrashFile = { originalPath: string; trashPath?: string };

      const deletedFiles: (TrashFile | NonTrashFile)[] = [];
      const failedFiles: string[] = [];

      // Start building response
      let response = t('delete.foundFiles', { count: docs.length });
      let deletedSection = '';
      let failedSection = '';

      for (const doc of docs) {
        const result = await this.trashFile({ filePath: doc.path });
        if (result.success) {
          deletedFiles.push({
            originalPath: result.originalPath,
            trashPath: result.trashPath,
          });

          // Build deleted files section
          const fileName = result.originalPath.split('/').pop() || result.originalPath;
          if (result.trashPath) {
            // Use alias format: [[trash_path|original_file_name]]
            deletedSection += `\n- [[${result.trashPath}|${fileName}]]`;
          } else {
            // For Obsidian trash or paths without trash path
            deletedSection += `\n- [[${result.originalPath}]]`;
          }
        } else {
          failedFiles.push(doc.path);
          // Build failed files section
          failedSection += `\n- [[${doc.path}]]`;
        }
      }

      if (isStwTrash && deletedFiles.length > 0) {
        await this.plugin.trashCleanupService.addFilesToTrash({
          files: deletedFiles as TrashFile[],
          artifactId,
        });
      }

      // Add sections to response if they exist
      if (deletedFiles.length > 0) {
        response += `\n\n**${t('delete.successfullyDeleted', { count: deletedFiles.length })}**`;
        response += deletedSection;
      }

      if (failedFiles.length > 0) {
        response += `\n\n**${t('delete.failed', { count: failedFiles.length })}**`;
        response += failedSection;
      }

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response,
        role: 'Steward',
        command: 'delete_from_artifact',
      });

      // Create DELETED_FILES artifact if files were moved to stw_trash
      if (isStwTrash && deletedFiles.length > 0) {
        await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          artifact: {
            artifactType: ArtifactType.DELETED_FILES,
            fileCount: deletedFiles.length,
            id: artifactId,
            createdAt: Date.now(),
          },
        });
      }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error deleting files: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
