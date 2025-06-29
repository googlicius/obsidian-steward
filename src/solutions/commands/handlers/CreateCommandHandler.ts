import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { TFile } from 'obsidian';
import { extractNoteCreation, NoteCreationExtraction } from 'src/lib/modelfusion/extractions';

import type StewardPlugin from 'src/main';
import type { CommandProcessor } from '../CommandProcessor';

export class CreateCommandHandler extends CommandHandler {
  constructor(
    public readonly plugin: StewardPlugin,
    public readonly commandProcessor: CommandProcessor
  ) {
    super();
  }

  /**
   * Render the loading indicator for the create command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.creating'));
  }

  /**
   * Handle a create command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      extraction?: NoteCreationExtraction;
      confirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, lang } = params;
    const t = getTranslation(lang);

    try {
      // If we have a cached extraction from confirmation, use it
      const extraction =
        options.extraction ||
        (await extractNoteCreation({
          userInput: command.content,
          app: this.app,
        }));

      // For low confidence extractions, just show the explanation
      if (extraction.confidence <= 0.7) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.explanation,
          role: 'Steward',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Low confidence in note creation extraction'),
        };
      }

      if (extraction.notes.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: '*No notes were specified for creation*',
          role: 'Steward',
          command: 'create',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No notes specified for creation'),
        };
      }

      // Ask for confirmation before creating notes
      if (!options.confirmed) {
        let message = `${t('create.confirmMessage', { count: extraction.notes.length })}\n`;

        // List notes to be created
        for (const note of extraction.notes) {
          const noteName = note.noteName ? `${note.noteName}.md` : '';
          if (noteName) {
            message += `- \`${noteName}\`\n`;
          }
        }

        message += `\n${t('create.confirmPrompt')}`;

        await this.renderer.updateConversationNote({
          path: title,
          newContent: message,
          role: 'Steward',
          command: 'create',
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          confirmationMessage: message,
          onConfirmation: () => {
            // When confirmed, call this handler again with the confirmed flag
            return this.handle(params, { extraction, confirmed: true });
          },
          onRejection: async () => {
            // Delete the next command if it is a generate command
            if (nextCommand && nextCommand.commandType === 'generate') {
              this.commandProcessor.deleteNextPendingCommand(title);
            }
            return {
              status: CommandResultStatus.SUCCESS,
            };
          },
        };
      }

      // Track successfully created notes
      const createdNotes: string[] = [];
      const createdNoteLinks: string[] = [];
      const errors: string[] = [];

      // Process each note
      for (const note of extraction.notes) {
        const newNotePath = note.noteName ? `${note.noteName}.md` : '';
        if (!newNotePath) {
          errors.push('Note name is missing');
          continue;
        }

        try {
          // Create the note
          await this.app.vault.create(newNotePath, '');
          createdNotes.push(newNotePath);
          createdNoteLinks.push(`[[${newNotePath}]]`);

          // Write the user-provided content to the note if available
          if (note.content) {
            await this.app.vault.modify(
              this.app.vault.getAbstractFileByPath(newNotePath) as TFile,
              note.content
            );
          }
        } catch (noteError) {
          errors.push(`Failed to create ${newNotePath}: ${noteError.message}`);
        }
      }

      // Store created notes as an artifact for future operations (if any were created)
      if (createdNotes.length > 0) {
        const messageId = await this.renderer.updateConversationNote({
          path: title,
          newContent: t('create.creatingNote', { noteName: createdNoteLinks.join(', ') }),
          role: 'Steward',
          command: 'create',
        });

        if (messageId) {
          this.artifactManager.storeArtifact(title, messageId, {
            type: ArtifactType.CREATED_NOTES,
            paths: createdNotes,
            createdAt: Date.now(),
          });
        }
      }

      // Create the result message
      let resultMessage = '';
      if (createdNotes.length > 0) {
        resultMessage = `*${t('create.success', {
          count: createdNotes.length,
          noteName: createdNotes.join(', '),
        })}*`;
      }

      if (errors.length > 0) {
        if (resultMessage) resultMessage += '\n\n';
        resultMessage += `*Errors:*\n${errors.map(e => `- ${e}`).join('\n')}`;
      }

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: resultMessage,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error creating notes: ${error.message}*`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
