import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { CommandIntentExtraction, extractCommandIntent } from 'src/lib/modelfusion/extractions';
import type StewardPlugin from 'src/main';
import type { CommandProcessor } from '../CommandProcessor';
import {
  STW_SELECTED_PATTERN,
  IMAGE_LINK_PATTERN,
  WIKI_LINK_PATTERN,
  STW_SELECTED_PLACEHOLDER,
} from 'src/constants';
import { ArtifactType } from '../../../services/ConversationArtifactManager';
import * as yaml from 'js-yaml';

export class GeneralCommandHandler extends CommandHandler {
  isContentRequired = true;

  constructor(
    public readonly plugin: StewardPlugin,
    private readonly commandProcessor: CommandProcessor
  ) {
    super();
  }

  /**
   * Render the loading indicator for the general command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.orchestrating'));
  }

  /**
   * Format extraction explanation as YAML format
   */
  private formatExtractionExplanation(extraction: CommandIntentExtraction, lang?: string): string {
    const t = getTranslation(lang);

    // Create the YAML data structure
    const yamlData: Record<string, unknown> = {
      name: 'Extraction details',
      commands: extraction.commands.map(cmd => ({
        [cmd.commandType]: cmd.query,
      })),
    };

    yamlData.explanation = extraction.explanation;
    yamlData.confidence = extraction.confidence;

    // Convert to YAML string
    const yamlContent = yaml.dump(yamlData, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    return `<a href="javascript:;" class="stw-extraction-details-link">${t('common.extractionDetails')}</a>\n\n\`\`\`yaml\n${yamlContent}\`\`\``;
  }

  /**
   * Handle a general command (space)
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      intentExtractionConfirmed?: boolean;
      extraction?: CommandIntentExtraction;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, upstreamOptions } = params;

    try {
      let extraction = options.extraction;

      // If extraction is not provided, extract conversation history and then get command intent
      if (!extraction) {
        const systemPrompts = command.systemPrompts || [];
        const conversationHistories = await this.renderer.extractConversationHistory(title);
        const hasStwSelected = new RegExp(STW_SELECTED_PATTERN).test(command.query);
        const hasImageLinks = new RegExp(IMAGE_LINK_PATTERN).test(command.query);
        const hasWikiLinks = new RegExp(WIKI_LINK_PATTERN).test(command.query);

        if (hasStwSelected) {
          systemPrompts.push(`The user query included one or more selections in this format {{stw-selected from:<startLine>,to:<endLine>,selection:<selectionContent>,path:<notePath>}}.
* **For generation tasks:** Use the <selectionContent> value from the selection(s) as the primary context for your response.
* **For update tasks:** The user wants to modify the note. Use the <notePath>, <startLine>, and <endLine> values to identify the exact location in the file to update. The new content should be generated based on the user's instructions and the provided context.
NOTE: 
- The selection content is included in the user's query, you don't need to read the note again.
- Pass the selection(s) placeholder: ${STW_SELECTED_PLACEHOLDER} to the downstream command's queries to maintain the context.`);
        }

        if (hasImageLinks) {
          systemPrompts.push(`The user query included one or more image links in this format ![[<imagePath>]].
- Include these image links in downstream command queries to maintain context.
- The follow commands support image reading: generate`);
        }

        if (hasWikiLinks) {
          systemPrompts.push(`The user query included one or more wikilinks in this format [[<notePath>]].
- Include these wikilinks in the same format in the downstream command queries to maintain context.
- The follow commands support wikilink reading: generate, read
- You don't need to issue a read command for the wikilinks, the wikilinks's content will be attached automatically.`);
        }

        // Get current artifacts for the conversation
        const currentArtifacts = this.artifactManager.getCurrentArtifacts(title);

        extraction = await extractCommandIntent({
          command: {
            ...command,
            systemPrompts,
          },
          lang: params.lang,
          conversationHistories,
          isReloadRequest: upstreamOptions?.isReloadRequest,
          ignoreClassify: upstreamOptions?.ignoreClassify,
          currentArtifacts,
        });
      }

      // Store the extraction result as an artifact
      this.artifactManager.storeArtifact(title, `extraction-${Date.now()}`, {
        type: ArtifactType.EXTRACTION_RESULT,
        content: {
          query: command.query,
          commands: extraction.commands,
        },
      });

      // Show extraction explanation if setting is enabled
      if (this.plugin.settings.llm.showExtractionExplanation && extraction.commands.length > 0) {
        const explanationContent = this.formatExtractionExplanation(extraction, params.lang);
        await this.renderer.updateConversationNote({
          path: title,
          newContent: explanationContent,
          lang: params.lang,
          includeHistory: false,
        });
      }

      if (extraction.commands.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.explanation,
          role: 'Steward',
          lang: params.lang,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: 'No commands are extracted',
        };
      }

      // For low confidence intents, return LOW_CONFIDENCE status
      if (extraction.confidence <= 0.7 && !options.intentExtractionConfirmed) {
        return {
          status: CommandResultStatus.LOW_CONFIDENCE,
          commandType: 'general',
          explanation: extraction.explanation,
        };
      }

      // Process the commands (either high confidence or confirmed)
      await this.commandProcessor.processCommands({
        title,
        commands: extraction.commands,
        originalQuery: command.query,
        lang: extraction.lang,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error processing your request: ${error.message}*`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
