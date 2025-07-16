import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import {
  CommandIntent,
  extractContentUpdate,
  extractNoteGeneration,
} from 'src/lib/modelfusion/extractions';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { streamText } from 'ai';
import { AbortService } from 'src/services/AbortService';
import {
  ContentUpdateExtraction,
  NoteGenerationExtraction,
  prepareUserMessage,
} from 'src/lib/modelfusion';
import { MediaTools } from 'src/tools/mediaTools';
import { LLMService } from 'src/services/LLMService';
import { ConversationHistoryMessage } from 'src/types/types';
import { languageEnforcementFragment } from 'src/lib/modelfusion/prompts/fragments';
import type StewardPlugin from 'src/main';

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
    const { title, command, prevCommand, lang } = params;

    try {
      if (prevCommand && prevCommand.commandType === 'read') {
        // Generate content from a read artifact
        return await this.generateFromReadArtifact(params);
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
    params: CommandHandlerParams,
    options: {
      lowConfidenceConfirmed?: boolean;
      extraction?: ContentUpdateExtraction | NoteGenerationExtraction;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, lang } = params;
    const t = getTranslation(lang);
    const readArtifact = this.artifactManager.getMostRecentArtifactByType(
      title,
      ArtifactType.READ_CONTENT
    );

    if (!readArtifact) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*No read content found*`,
        lang,
      });
      return {
        status: CommandResultStatus.ERROR,
        error: new Error('No read content found'),
      };
    }

    const readContentsStringified = JSON.stringify(
      readArtifact.readingResult.blocks.map(block => block.content)
    );

    const userInput = `The content from the current note:\n${readContentsStringified}\n\n${command.query}`;

    let extraction = options.extraction;

    if (!extraction) {
      extraction =
        nextCommand && nextCommand.commandType === 'update_from_artifact'
          ? await extractContentUpdate({
              command: {
                ...command,
                query: userInput,
              },
              app: this.app,
            })
          : await extractNoteGeneration({
              command: {
                ...command,
                query: userInput,
              },
            });
    }

    // If the confidence is low, ask for confirmation
    if (extraction.confidence <= 0.7 && !options.lowConfidenceConfirmed) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        includeHistory: false,
        lang,
      });

      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('common.lowConfidenceConfirmation')}*`,
        lang,
      });

      return {
        status: CommandResultStatus.NEEDS_CONFIRMATION,
        onConfirmation: () => {
          return this.generateFromReadArtifact(params, {
            lowConfidenceConfirmed: true,
            extraction,
          });
        },
      };
    }

    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

    try {
      if ('updates' in extraction) {
        if (extraction.updates.length === 0) {
          return {
            status: CommandResultStatus.SUCCESS,
          };
        }

        const messageId = await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.explanation,
          includeHistory: false,
          lang,
        });

        // Store the content update extraction as an artifact
        if (messageId) {
          this.artifactManager.storeArtifact(title, messageId, {
            type: ArtifactType.CONTENT_UPDATE,
            updateExtraction: extraction,
            // Current path is active editing
            path: this.app.workspace.getActiveFile()?.path || '',
          });

          await this.renderer.updateConversationNote({
            path: title,
            newContent: `*${t('common.artifactCreated', {
              type: ArtifactType.CONTENT_UPDATE,
            })}*`,
            command: 'generate',
            role: 'System',
            lang,
          });
        }

        for (const update of extraction.updates) {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: this.renderer.formatCallout(update.updatedContent),
            lang,
          });
        }
      } else {
        const stream = await this.contentGenerationStream({
          ...command,
          query: userInput,
        });

        await this.renderer.streamConversationNote({
          path: title,
          stream,
          command: 'generate',
        });
      }
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error generating content: ${error.message}*`,
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }

    return {
      status: CommandResultStatus.SUCCESS,
    };
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
      command: {
        ...command,
        query: command.query,
      },
      recentlyCreatedNote,
    });

    await this.renderer.updateConversationNote({
      path: title,
      newContent: extraction.explanation,
      role: 'Steward',
      includeHistory: false,
      lang,
    });

    if (extraction.confidence < 0.7) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('common.abortedByLowConfidence')}*`,
        lang,
      });
      return;
    }

    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

    const mediaTools = MediaTools.getInstance(this.app);

    const file = extraction.noteName
      ? await mediaTools.findFileByNameOrPath(extraction.noteName)
      : null;

    const conversationHistory = await this.renderer.extractConversationHistory(title);

    // Prepare for content generation
    const stream = await this.contentGenerationStream(command, conversationHistory);

    // stream content to current conversation
    if (!extraction.noteName || !extraction.modifiesNote || !file) {
      await this.renderer.streamConversationNote({
        path: title,
        stream,
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

    // Accumulate the content from the stream
    let accumulatedContent = '';
    for await (const chunk of stream) {
      accumulatedContent += chunk;
    }

    // Update the file once with the complete content after streaming is done
    await this.app.vault.modify(file, accumulatedContent);

    // Update the conversation with the results
    await this.renderer.updateConversationNote({
      path: title,
      newContent: `*${t('generate.success', { noteName: extraction.noteName })}*`,
      lang,
    });

    // Delete artifact
    this.artifactManager.deleteArtifact(title, ArtifactType.CREATED_NOTES);
  }

  private async contentGenerationStream(
    command: CommandIntent,
    conversationHistory: ConversationHistoryMessage[] = []
  ): Promise<AsyncIterable<string>> {
    const { query, systemPrompts = [], model } = command;
    const llmConfig = await LLMService.getInstance().getLLMConfig(model);

    let prompt = query;

    // For ongoing conversation, use the latest user message as the prompt
    if (conversationHistory.length > 1) {
      for (let i = 0; i < conversationHistory.length; i++) {
        const message = conversationHistory[conversationHistory.length - i - 1];
        if (message.role === 'user') {
          prompt = message.content;
          break;
        }
      }
    }

    const { textStream } = streamText({
      ...llmConfig,
      abortSignal: abortService.createAbortController('generate'),
      system: `You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content. Format the content in Markdown.
The content should not include the big heading on the top.
${languageEnforcementFragment}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory.slice(0, -1),
        {
          role: 'user',
          content: await prepareUserMessage(prompt, this.app),
        },
      ],
    });

    return textStream;
  }
}
