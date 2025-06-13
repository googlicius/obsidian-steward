import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { Events } from 'src/types/events';
import { eventEmitter } from 'src/services/EventEmitter';

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
   * Handle a delete command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command, lang } = params;
    const t = getTranslation(lang);

    try {
      // Retrieve the most recent artifact regardless of type
      const artifact = this.artifactManager.getMostRecentArtifact(title);

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
      let docs: any[] = [];

      if (artifact.type === ArtifactType.SEARCH_RESULTS) {
        docs = artifact.originalResults;
      } else if (artifact.type === ArtifactType.CREATED_NOTES) {
        docs = artifact.paths.map(path => ({ path }));
      } else {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.cannotDeleteThisType'),
          role: 'Steward',
        });

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

      // Delete the files directly
      const deletedFiles: string[] = [];
      const failedFiles: string[] = [];

      for (const doc of docs) {
        try {
          const file = this.app.vault.getAbstractFileByPath(doc.path);
          if (file) {
            await this.app.vault.delete(file);
            deletedFiles.push(doc.path);
          }
        } catch (error) {
          failedFiles.push(doc.path);
        }
      }

      // Format the results
      let response = t('delete.foundFiles', { count: docs.length });

      if (deletedFiles.length > 0) {
        response += `\n\n**${t('delete.successfullyDeleted', { count: deletedFiles.length })}**`;
        deletedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (failedFiles.length > 0) {
        response += `\n\n**${t('delete.failed', { count: failedFiles.length })}**`;
        failedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response,
        role: 'Steward',
        command: 'delete_from_artifact',
      });

      // Emit the delete operation completed event
      eventEmitter.emit(Events.DELETE_OPERATION_COMPLETED, {
        title,
        operations: [
          {
            sourceQuery: command.content,
            deleted: deletedFiles,
            errors: failedFiles,
          },
        ],
      });

      // Delete the artifact
      this.artifactManager.deleteArtifact(title, artifact.id);

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
