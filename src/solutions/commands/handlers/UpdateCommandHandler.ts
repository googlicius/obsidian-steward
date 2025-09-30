import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { Events } from 'src/types/events';
import { eventEmitter } from 'src/services/EventEmitter';
import { extractUpdateFromSearchResult, UpdateInstruction } from 'src/lib/modelfusion/extractions';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { DocWithPath } from 'src/types/types';

const updatableTypes = [
  ArtifactType.SEARCH_RESULTS,
  ArtifactType.CREATED_NOTES,
  ArtifactType.READ_CONTENT,
  ArtifactType.CONTENT_UPDATE,
];

export class UpdateCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the update command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.updating'));
  }

  /**
   * Handle an update command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command, lang } = params;
    const t = getTranslation(lang);

    try {
      // Retrieve the most recent artifact of updatable types
      const artifact = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactOfTypes(updatableTypes);

      if (!artifact) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.noRecentOperations')}*`,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No recent operations found'),
        };
      }

      // If we have a content update artifact, we can use it directly
      if (artifact.artifactType === ArtifactType.CONTENT_UPDATE) {
        // Convert the updates in the extraction to UpdateInstruction objects
        const updateInstructions = artifact.updateExtraction.updates
          .filter(update => update.updatedContent !== update.originalContent)
          .map(update => ({
            type: 'replace' as const,
            old: update.originalContent,
            new: update.updatedContent,
          }));

        if (updateInstructions.length === 0) {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: t('update.noChangesNeeded'),
            lang,
          });
          return {
            status: CommandResultStatus.SUCCESS,
          };
        }

        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('update.applyChangesConfirm'),
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.performUpdateFromArtifact(title, updateInstructions, lang);
          },
          onRejection: () => {
            // this.artifactManager.deleteArtifact(title, artifact.id);
            return {
              status: CommandResultStatus.SUCCESS,
            };
          },
        };
      }

      const conversationHistory = await this.renderer.extractConversationHistory(title);

      // For other artifact types, extract the update instructions
      const extraction = await extractUpdateFromSearchResult({
        userInput: command.query,
        systemPrompts: command.systemPrompts,
        conversationHistory,
        model: command.model,
      });

      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${extraction.explanation}*`,
        includeHistory: false,
      });

      if (extraction.confidence <= 0.7) {
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Low confidence in update extraction'),
        };
      }

      // Perform the updates
      return this.performUpdateFromArtifact(title, extraction.updateInstructions, extraction.lang);
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error extracting update instructions: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Perform the actual update operation
   */
  private async performUpdateFromArtifact(
    title: string,
    updateInstructions: UpdateInstruction[],
    lang?: string | null
  ): Promise<CommandResult> {
    const t = getTranslation(lang);

    try {
      // Retrieve the most recent artifact of updatable types
      const artifact = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactOfTypes(updatableTypes);

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
        docs = artifact.originalResults.map(result => ({ path: result.document.path }));
      } else if (artifact.artifactType === ArtifactType.CREATED_NOTES) {
        docs = artifact.paths.map(path => ({ path }));
      } else if (artifact.artifactType === ArtifactType.CONTENT_UPDATE) {
        docs = [{ path: artifact.path }];
      } else {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.noFilesFound'),
          role: 'Steward',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No files found'),
        };
      }

      // Perform the updates
      const updatedFiles: string[] = [];
      const failedFiles: string[] = [];
      const skippedFiles: string[] = [];

      for (const doc of docs) {
        try {
          const file = await this.plugin.mediaTools.findFileByNameOrPath(doc.path);
          if (file) {
            // Read the file content
            let content = await this.app.vault.read(file);

            let contentChanged = false;

            // Apply each update instruction in sequence
            for (const instruction of updateInstructions) {
              const updatedContent = await this.obsidianAPITools.applyUpdateInstruction(
                content,
                instruction
              );

              if (updatedContent !== content) {
                content = updatedContent;
                contentChanged = true;
              }
            }

            if (!contentChanged) {
              logger.log(`Skipping ${doc.path} because it didn't change`);
              skippedFiles.push(doc.path);
              continue;
            }

            // Write the updated content back
            await this.app.vault.process(file, () => content);
            updatedFiles.push(doc.path);
          }
        } catch (error) {
          failedFiles.push(doc.path);
        }
      }

      // Format the results
      let response = t('update.foundFiles', { count: docs.length });

      if (updatedFiles.length > 0) {
        response += `\n\n**${t('update.successfullyUpdated', { count: updatedFiles.length })}**`;
        updatedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (skippedFiles.length > 0) {
        response += `\n\n**${t('update.skipped', { count: skippedFiles.length })}**`;
        skippedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (failedFiles.length > 0) {
        response += `\n\n**${t('update.failed', { count: failedFiles.length })}**`;
        failedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response,
        role: 'Steward',
        command: 'update',
      });

      // Emit the update operation completed event
      eventEmitter.emit(Events.UPDATE_OPERATION_COMPLETED, {
        title,
        operations: [
          {
            updateInstruction: JSON.stringify(updateInstructions),
            updated: updatedFiles,
            skipped: skippedFiles,
            errors: failedFiles,
          },
        ],
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error updating files: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
