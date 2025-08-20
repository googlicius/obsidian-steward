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
import { streamText, APICallError } from 'ai';
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
import { logger } from 'src/utils/logger';
import { STW_SELECTED_PATTERN } from 'src/constants';
import { MarkdownUtil } from 'src/utils/markdownUtils';

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
    const { title } = params;

    try {
      return await this.generateContent(params);
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

  private async generateContent(
    params: CommandHandlerParams,
    options: {
      lowConfidenceConfirmed?: boolean;
      extraction?: ContentUpdateExtraction | NoteGenerationExtraction;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, lang, prevCommand } = params;
    const t = getTranslation(lang);

    const fromRead = prevCommand && prevCommand.commandType === 'read';
    const systemPrompts = [];

    const hasStwSelected = new RegExp(STW_SELECTED_PATTERN).test(command.query);

    if (hasStwSelected) {
      systemPrompts.push(`The user query included one or more selections in the format {{stw-selected from:<startLine>,to:<endLine>,selection:<selectionContent>,path:<notePath>}}.
Use the <selectionContent> value from the selection(s) as the primary context for your response.
The response should be in natural language and not include the selection(s) {{stw-selected...}}`);
    }

    let readArtifact;
    if (fromRead) {
      readArtifact = this.artifactManager.getMostRecentArtifactByType(
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

      const noteName = readArtifact.readingResult.file?.name || 'current';

      systemPrompts.push(
        `The read command's content from the ${noteName} note:\n${JSON.stringify(
          readArtifact.readingResult.blocks.map(block => block.content)
        )}`
      );
    }

    let recentlyCreatedNote = '';
    const createdNotesArtifact = this.artifactManager.getMostRecentArtifactByType(
      title,
      ArtifactType.CREATED_NOTES
    );
    if (createdNotesArtifact && createdNotesArtifact.type === ArtifactType.CREATED_NOTES) {
      recentlyCreatedNote = createdNotesArtifact.paths[0] || '';
    }

    const isUpdate = nextCommand && nextCommand.commandType === 'update_from_artifact';

    let extraction = options.extraction;

    if (!extraction) {
      if (isUpdate) {
        extraction = await extractContentUpdate({
          command: {
            ...command,
            systemPrompts,
          },
          app: this.app,
        });
      } else {
        extraction = await extractNoteGeneration({
          command: {
            ...command,
            systemPrompts,
          },
          recentlyCreatedNote: fromRead ? undefined : recentlyCreatedNote,
        });
      }
    }

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
          return this.generateContent(params, {
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

        if (messageId) {
          this.artifactManager.storeArtifact(title, messageId, {
            type: ArtifactType.CONTENT_UPDATE,
            updateExtraction: extraction,
            path: extraction.notePath || this.app.workspace.getActiveFile()?.path || '',
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
            newContent: this.plugin.noteContentService.formatCallout(
              update.updatedContent,
              'stw-search-result',
              {
                mdContent: new MarkdownUtil(update.updatedContent)
                  .escape(true)
                  .encodeForDataset()
                  .getText(),
              }
            ),
            lang,
          });
        }
      } else {
        const conversationHistory = fromRead
          ? []
          : await this.renderer.extractConversationHistory(title);

        const mediaTools = MediaTools.getInstance(this.app);

        const file = extraction.noteName
          ? await mediaTools.findFileByNameOrPath(extraction.noteName)
          : null;

        const noteContent = file ? await this.app.vault.read(file) : '';

        const stream = await this.contentGenerationStream({
          command: {
            ...command,
            systemPrompts,
          },
          conversationHistory,
          errorCallback: async error => {
            if (error instanceof APICallError && error.statusCode === 422) {
              await this.renderer.updateConversationNote({
                path: title,
                newContent: `*Error: Unprocessable Content*`,
                role: 'System',
              });
            }
          },
        });

        if (
          fromRead ||
          !extraction.noteName ||
          !extraction.modifiesNote ||
          !file ||
          noteContent.trim() !== ''
        ) {
          await this.renderer.streamConversationNote({
            path: title,
            stream,
            command: 'generate',
          });
        } else {
          const mainLeaf = await this.plugin.getMainLeaf();

          if (mainLeaf && file) {
            mainLeaf.openFile(file);
            await this.app.workspace.revealLeaf(mainLeaf);
          }

          let accumulatedContent = '';
          for await (const chunk of stream) {
            accumulatedContent += chunk;
          }

          await this.app.vault.process(file, () => accumulatedContent);

          await this.renderer.updateConversationNote({
            path: title,
            newContent: `*${t('generate.success', { noteName: extraction.noteName })}*`,
            lang,
          });

          this.artifactManager.deleteArtifact(title, ArtifactType.CREATED_NOTES);
        }
      }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error generating: ${error.message}*`,
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  private async contentGenerationStream(args: {
    command: CommandIntent;
    conversationHistory?: ConversationHistoryMessage[];
    errorCallback?: (error: unknown) => Promise<void>;
  }): Promise<AsyncIterable<string>> {
    const { command, conversationHistory = [], errorCallback } = args;
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
      onError: async ({ error }) => {
        try {
          if (errorCallback) {
            await errorCallback(error);
          }
        } catch (callbackError) {
          logger.error('Error in error callback:', callbackError);
        }
      },
    });

    return textStream;
  }
}
