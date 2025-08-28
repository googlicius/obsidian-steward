import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { logger } from 'src/utils/logger';
import { getTranslation } from 'src/i18n/index';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import type StewardPlugin from 'src/main';
import type { CommandProcessor } from '../CommandProcessor';
import { ContextAugmentationIntent } from 'src/types/types';

/**
 * Handler for context augmentation
 */
export class ContextAugmentationHandler extends CommandHandler {
  constructor(
    public readonly plugin: StewardPlugin,
    private readonly commandProcessor: CommandProcessor
  ) {
    super();
  }

  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.augmentingContext'));
  }

  public async handle(
    params: CommandHandlerParams<ContextAugmentationIntent>
  ): Promise<CommandResult> {
    const { title, lang, command } = params;
    const t = getTranslation(lang);

    if (command.retryRemaining === 0) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('common.abortedByLowConfidence')}*`,
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
      };
    }

    try {
      const pendingCommandData = this.commandProcessor.getPendingCommand(title);

      // Get the most recent extraction result
      const extractionArtifact = this.artifactManager.getMostRecentArtifactByType(
        title,
        ArtifactType.EXTRACTION_RESULT
      );

      if (!extractionArtifact || !extractionArtifact.content) {
        logger.error('No extraction result found for context augmentation');
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error: No extraction result found for context augmentation*`,
          includeHistory: false,
          lang,
        });
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No extraction result found for context augmentation'),
        };
      }

      const extraction = extractionArtifact.content;
      const lastCommandResult = pendingCommandData?.lastCommandResult;

      const lastCommandResultStr =
        lastCommandResult?.status === CommandResultStatus.LOW_CONFIDENCE
          ? `Command type: ${lastCommandResult.commandType}, explanation: ${lastCommandResult.explanation}`
          : '';

      // Format the commands for the system prompt
      const commandsText = extraction.commands
        .map(cmd => `- Command: ${cmd.commandType}, Query: "${cmd.query}"`)
        .join('\n');

      // Create augmented system prompt with the original query and extracted commands
      const augmentedSystemPrompt = `
The user sent this query: "${extraction.query}"

It is being extracted as the following commands:
${commandsText}

The last command result was:
${lastCommandResultStr}

Retry attempt: ${4 - command.retryRemaining} of 3
You task is to evaluate and re-analyze this query with the above context to improve extraction confidence.
      `.trim();

      // Process with general command and the augmented system prompt
      await this.plugin.commandProcessorService.processCommands(
        {
          title,
          commands: [
            {
              commandType: ' ',
              query: extraction.query,
              systemPrompts: [augmentedSystemPrompt],
            },
          ],
          lang,
        },
        {
          skipQueueCheck: true,
        }
      );

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error in ContextAugmentationHandler:', error);

      return {
        status: CommandResultStatus.ERROR,
      };
    }
  }
}
