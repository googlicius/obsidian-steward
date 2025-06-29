import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { extractReadContent } from 'src/lib/modelfusion/extractions';
import { ContentReadingService } from 'src/services/ContentReadingService';

import type StewardPlugin from 'src/main';
import type { CommandProcessor } from '../CommandProcessor';

type ExtractReadContentResult = Awaited<ReturnType<typeof extractReadContent>>;

export class ReadCommandHandler extends CommandHandler {
  constructor(
    public readonly plugin: StewardPlugin,
    public readonly commandProcessor: CommandProcessor
  ) {
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
    options: { extraction?: ExtractReadContentResult; readEntireContent?: boolean } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, lang } = params;
    const t = getTranslation(lang);

    try {
      // Extract the reading instructions using LLM
      const extraction = options.extraction || (await extractReadContent(command.content));

      // Find all content reading tool calls
      const contentReadingToolCalls = extraction.toolCalls.filter(
        toolCall => toolCall.toolName === 'contentReading'
      );

      if (contentReadingToolCalls.length === 0) {
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No content reading tool call found'),
        };
      }

      // Check if any tool call is for entire content and needs confirmation
      const hasEntireReadType = contentReadingToolCalls.some(
        toolCall => toolCall.args.readType === 'entire'
      );

      if (hasEntireReadType && !options.readEntireContent) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('read.readEntireContentConfirmation'),
          role: 'Steward',
          command: 'read',
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.handle(params, { extraction, readEntireContent: true });
          },
        };
      }

      // Process all tool calls
      const readingResults = [];
      let stewardReadMetadata = null;

      for (const toolCall of contentReadingToolCalls) {
        // Read the content from the editor
        const readingResult = await ContentReadingService.getInstance().readContent(toolCall.args);

        if (!readingResult) {
          continue; // Skip this tool call if reading failed
        }

        readingResults.push({
          toolCall,
          readingResult,
        });
      }

      if (readingResults.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('read.unableToReadContent')}*`,
          role: 'Steward',
          command: 'read',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Unable to read content from the editor'),
        };
      }

      // Use the explanation from the first successful tool call
      stewardReadMetadata = await this.renderer.updateConversationNote({
        path: title,
        newContent: readingResults[0].toolCall.args.explanation,
        role: 'Steward',
        command: 'read',
      });

      // Check confidence for all tool calls
      const lowConfidenceCall = readingResults.find(
        result => result.toolCall.args.confidence <= 0.7
      );

      if (lowConfidenceCall) {
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Low confidence in reading extraction'),
        };
      }

      // Check if any content was found
      const hasContent = readingResults.some(
        result =>
          result.readingResult.blocks.length > 0 && result.readingResult.elementType !== 'unknown'
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
      const totalBlocks = readingResults.reduce(
        (total, result) => total + result.readingResult.blocks.length,
        0
      );

      // Use the placeholder from the first tool call
      await this.renderer.updateConversationNote({
        path: title,
        newContent: readingResults[0].toolCall.args.foundPlaceholder.replace(
          '{{number}}',
          totalBlocks.toString()
        ),
      });

      // If there is no next command, show the read results
      if (!nextCommand) {
        for (const result of readingResults) {
          for (const block of result.readingResult.blocks) {
            const endLine = this.plugin.editor.getLine(block.endLine);
            await this.renderer.updateConversationNote({
              path: title,
              newContent: this.renderer.formatCallout(block.content, 'search-result', {
                startLine: block.startLine,
                endLine: block.endLine,
                start: 0,
                end: endLine.length,
                path: result.readingResult.file?.path,
              }),
            });
          }
        }
      }

      // Store the read content in the artifact manager - use the first result for now
      // This could be enhanced to store all results if needed
      if (stewardReadMetadata && readingResults.length > 0) {
        this.artifactManager.storeArtifact(title, stewardReadMetadata, {
          type: ArtifactType.READ_CONTENT,
          readingResult: readingResults[0].readingResult,
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
