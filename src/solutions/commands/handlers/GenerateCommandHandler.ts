import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import {
  CommandIntent,
  extractContentUpdate,
  extractNoteGeneration,
} from 'src/lib/modelfusion/extractions';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { TFile } from 'obsidian';
import { streamText } from 'modelfusion';
import { createLLMGenerator } from 'src/lib/modelfusion/llmConfig';
import { userLanguagePromptText } from 'src/lib/modelfusion/prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { user } from 'src/lib/modelfusion/overridden/OpenAIChatMessage';
import { prepareUserMessage } from 'src/lib/modelfusion';

const abortService = AbortService.getInstance();

export class GenerateCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the generate command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));
  }

  /**
   * Handle a generate command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command, prevCommand, nextCommand, lang } = params;

    try {
      if (prevCommand && prevCommand.commandType === 'read') {
        // Generate content from a read artifact
        await this.generateFromReadArtifact(title, command, nextCommand, lang);
      } else {
        // Default generation (including after create)
        await this.generateFromCreateOrDefault(title, command, lang);
      }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error generating content: ${error.message}*`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Generate content based on previously read content
   * @param title The conversation title
   * @param command The current command
   * @param nextCommand The next command (optional)
   * @param lang Optional language code for the response
   */
  private async generateFromReadArtifact(
    title: string,
    command: CommandIntent,
    nextCommand?: CommandIntent,
    lang?: string
  ): Promise<void> {
    const t = getTranslation(lang);
    const readArtifact = this.artifactManager.getMostRecentArtifactByType(
      title,
      ArtifactType.READ_CONTENT
    );

    if (!readArtifact) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*No read content found*`,
      });
      return;
    }

    const contentsStr = JSON.stringify(
      readArtifact.readingResult.blocks.map(block => block.content)
    );

    const userInput = `T content from the current note:\n${contentsStr}\n\n${command.content}`;

    const extraction =
      nextCommand && nextCommand.commandType === 'update_from_artifact'
        ? await extractContentUpdate({
            userInput,
            systemPrompts: command.systemPrompts,
            llmConfig: this.settings.llm,
            app: this.app,
          })
        : await extractNoteGeneration({
            userInput,
            systemPrompts: command.systemPrompts,
            llmConfig: this.settings.llm,
          });

    if (extraction.confidence <= 0.7) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
      });

      return;
    }

    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

    if ('updates' in extraction) {
      if (extraction.updates.length === 0) {
        return;
      }

      const messageId = await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
      });

      // Store the content update extraction as an artifact
      if (messageId) {
        this.artifactManager.storeArtifact(title, messageId, {
          type: ArtifactType.CONTENT_UPDATE,
          updateExtraction: extraction,
          // Current path is active editing
          path: this.app.workspace.getActiveFile()?.path || '',
        });
      }

      for (const update of extraction.updates) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: this.renderer.formatCallout(update.updatedContent),
        });
      }
    } else {
      const stream = await this.contentGenerationStream({ ...command, content: userInput });

      await this.renderer.streamConversationNote({
        path: title,
        stream,
        command: 'generate',
      });
    }
  }

  /**
   * Generate content for a note or conversation
   * @param title The conversation title
   * @param command The current command
   * @param lang Optional language code for the response
   */
  private async generateFromCreateOrDefault(
    title: string,
    command: CommandIntent,
    lang?: string
  ): Promise<void> {
    const t = getTranslation(lang);

    // Check if there's a recently created note artifact
    let recentlyCreatedNote = '';
    const createdNotesArtifact = this.artifactManager.getMostRecentArtifactByType(
      title,
      ArtifactType.CREATED_NOTES
    );

    if (createdNotesArtifact && createdNotesArtifact.type === ArtifactType.CREATED_NOTES) {
      // Use the first note path if available
      recentlyCreatedNote = createdNotesArtifact.paths[0] || '';
    }

    // Extract the content generation details using the LLM
    const extraction = await extractNoteGeneration({
      userInput: command.content,
      systemPrompts: command.systemPrompts,
      llmConfig: this.settings.llm,
      recentlyCreatedNote,
    });

    // For low confidence extractions, just show the explanation
    await this.renderer.updateConversationNote({
      path: title,
      newContent: extraction.explanation,
      role: 'Steward',
    });

    if (extraction.confidence < 0.7) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: '*Low confidence extraction, skipping*',
      });
      return;
    }

    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

    // Prepare for content generation
    const stream = await this.contentGenerationStream(command);

    // If no note name is provided or the user does not want to modify the note,
    // stream content to current conversation
    if (!extraction.noteName || !extraction.modifiesNote) {
      await this.renderer.streamConversationNote({
        path: title,
        stream,
        command: 'generate',
      });
      return;
    }

    // Check if the note exists
    const notePath = extraction.noteName.endsWith('.md')
      ? extraction.noteName
      : `${extraction.noteName}.md`;

    const file = (this.app.vault.getAbstractFileByPath(notePath) as TFile) || null;

    if (!file) {
      // If file doesn't exist, inform the user
      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('generate.fileNotFound', { noteName: notePath }),
        role: 'Steward',
        command: 'generate',
      });
      return;
    }

    const mainLeaf = await this.plugin.getMainLeaf();

    // Open the file in the main leaf
    if (mainLeaf && file) {
      mainLeaf.openFile(file);
      await this.app.workspace.revealLeaf(mainLeaf);
    }

    // Stream the content to the note
    let accumulatedContent = '';
    for await (const chunk of stream) {
      accumulatedContent += chunk;
      await this.app.vault.modify(file, accumulatedContent);
    }

    // Update the conversation with the results
    await this.renderer.updateConversationNote({
      path: title,
      newContent: `*${t('generate.success', { noteName: extraction.noteName })}*`,
    });

    // Delete artifact
    this.artifactManager.deleteArtifact(title, ArtifactType.CREATED_NOTES);
  }

  private async contentGenerationStream(command: CommandIntent): Promise<AsyncIterable<string>> {
    const { content, systemPrompts = [] } = command;

    return streamText({
      model: createLLMGenerator({ ...this.settings.llm, responseFormat: 'text' }),
      run: { abortSignal: abortService.createAbortController('generate') },
      prompt: [
        {
          role: 'system',
          content: `You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content. Format the content in Markdown.
The content should not include the big heading on the top.`,
        },
        userLanguagePromptText,
        ...systemPrompts.map(prompt => ({ role: 'system', content: prompt })),
        user(await prepareUserMessage(content, this.app)),
      ],
    });
  }
}
