import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { extractReadContent } from 'src/lib/modelfusion/extractions';
import { ContentReadingResult, ContentReadingService } from 'src/services/ContentReadingService';
import type StewardPlugin from 'src/main';

type ExtractReadContentResult = Awaited<ReturnType<typeof extractReadContent>>;

export class ReadCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the read command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.readingContent'));
  }

  /**
   * Handle a read command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      /**
       * The extraction result from the LLM before confirmation
       */
      extraction?: ExtractReadContentResult;
      /**
       * Whether the user has confirmed reading the entire content
       */
      readEntireConfirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand } = params;

    try {
      // Extract the reading instructions using LLM
      const extraction = options.extraction || (await extractReadContent(command));
      const lang =
        extraction.toolCalls.length > 0 ? extraction.toolCalls[0].args.lang : params.lang;
      const t = getTranslation(lang);

      // Find all content reading tool calls
      const contentReadingToolCalls = extraction.toolCalls.filter(
        toolCall => toolCall.toolName === 'contentReading'
      );

      if (contentReadingToolCalls.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.text || `*${t('common.noToolCallFound')}*`,
          role: 'Steward',
          command: 'read',
          includeHistory: false,
          lang,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No content reading tool call found'),
        };
      }

      // Check if any tool call is for entire content and needs confirmation
      const entireContentReadCall = contentReadingToolCalls.find(
        toolCall => toolCall.args.readType === 'entire'
      );

      if (entireContentReadCall && !options.readEntireConfirmed) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('read.readEntireContentConfirmation', {
            noteName: entireContentReadCall.args.noteName,
          }),
          role: 'Steward',
          command: 'read',
          lang,
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.handle(params, { extraction, readEntireConfirmed: true });
          },
        };
      }

      // Process all tool calls
      const readingResults: ContentReadingResult[] = [];
      let stewardMessageId = null;

      for (const toolCall of contentReadingToolCalls) {
        // Read the content from the editor
        const readingResult = await ContentReadingService.getInstance().readContent(toolCall.args);

        if (!readingResult) {
          continue; // Skip this tool call if reading failed
        }

        readingResults.push(readingResult);
      }

      // Use the explanation from the first successful tool call
      stewardMessageId = await this.renderer.updateConversationNote({
        path: title,
        newContent: contentReadingToolCalls[0].args.explanation,
        role: 'Steward',
        command: 'read',
        includeHistory: false,
        lang,
      });

      if (readingResults.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('read.unableToReadContent')}*`,
          command: 'read',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Unable to read content from the editor'),
        };
      }

      // Check confidence for all tool calls
      const lowConfidenceCall = contentReadingToolCalls.find(
        result => result.args.confidence <= 0.7
      );

      if (lowConfidenceCall) {
        return {
          status: CommandResultStatus.LOW_CONFIDENCE,
          commandType: 'read',
          explanation: lowConfidenceCall.args.explanation,
        };
      }

      // Check if any content was found
      const hasContent = readingResults.some(
        result => result.blocks.length > 0 && result.elementType !== 'unknown'
      );

      if (!hasContent) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('read.noContentFound')}*`,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No content found to read'),
        };
      }

      // Show the user the total number of blocks found across all tool calls
      const totalBlocks = readingResults.reduce((total, result) => total + result.blocks.length, 0);

      // Use the placeholder from the first tool call
      if (contentReadingToolCalls[0].args.foundPlaceholder) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: contentReadingToolCalls[0].args.foundPlaceholder.replace(
            '{{number}}',
            totalBlocks.toString()
          ),
        });
      }

      // If there is no next command, show the read results
      if (!nextCommand) {
        for (const result of readingResults) {
          for (const block of result.blocks) {
            const endLine = this.plugin.editor.getLine(block.endLine);
            await this.renderer.updateConversationNote({
              path: title,
              newContent: this.plugin.noteContentService.formatCallout(
                block.content,
                'stw-search-result',
                {
                  startLine: block.startLine,
                  endLine: block.endLine,
                  start: 0,
                  end: endLine.length,
                  path: result.file?.path,
                }
              ),
            });
          }
        }
      }

      // Store the read content in the artifact manager - use the first result for now
      // This could be enhanced to store all results if needed
      if (stewardMessageId && readingResults.length > 0) {
        this.artifactManager.storeArtifact(title, stewardMessageId, {
          type: ArtifactType.READ_CONTENT,
          readingResult: readingResults[0],
        });
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.artifactCreated', { type: ArtifactType.READ_CONTENT })}*`,
          artifactContent: readingResults[0].blocks.map(block => block.content).join('\n\n'),
          role: 'System',
          command: 'read',
        });
      }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error reading content: ${error.message}*`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
