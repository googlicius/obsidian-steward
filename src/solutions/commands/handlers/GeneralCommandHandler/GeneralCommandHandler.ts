import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import type StewardPlugin from 'src/main';
import {
  STW_SELECTED_PATTERN,
  IMAGE_LINK_PATTERN,
  WIKI_LINK_PATTERN,
  STW_SELECTED_PLACEHOLDER,
} from 'src/constants';
import { Artifact } from 'src/solutions/artifact';
import * as yaml from 'js-yaml';
import { generateObject } from 'ai';
import { getCommandTypePrompt } from './commandTypePrompt';
import { getQueryExtractionPrompt } from './queryExtractionPrompt';
import { logger } from 'src/utils/logger';
import { ConversationHistoryMessage, CommandIntent } from 'src/types/types';
import { getClassifier } from 'src/lib/modelfusion/classifiers/getClassifier';
import {
  commandTypeExtractionSchema,
  queryExtractionSchema,
  CommandTypeExtraction,
  QueryExtraction,
} from './zSchemas';

export type CommandIntentExtraction = Omit<CommandTypeExtraction, 'commandTypes'> & QueryExtraction;

export class GeneralCommandHandler extends CommandHandler {
  isContentRequired = true;

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the general command
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.orchestrating'));
  }

  /**
   * Extract command intents from a general query using AI with a 2-step approach
   * Step 1: Extract command types
   * Step 2: Extract specific queries for each command type
   * @returns Extracted command types, content, and explanation
   */
  private async extractCommandIntent(args: {
    command: CommandIntent;
    conversationHistories: ConversationHistoryMessage[];
    lang?: string | null;
    isReloadRequest?: boolean;
    ignoreClassify?: boolean;
    currentArtifacts?: Artifact[];
  }): Promise<CommandIntentExtraction> {
    const {
      command,
      lang,
      conversationHistories = [],
      isReloadRequest = false,
      ignoreClassify = !this.plugin.settings.embedding.enabled,
      currentArtifacts,
    } = args;

    try {
      logger.log('Starting 2-step intent extraction process');

      // Get classifier for semantic similarity check
      let commandTypeExtraction: CommandTypeExtraction | undefined;

      if (!ignoreClassify) {
        const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
        const classifier = getClassifier(embeddingSettings, isReloadRequest);
        const clusterName = await classifier.doClassify(command.query);

        if (clusterName) {
          logger.log(`The user input was classified as "${clusterName}"`);
          const classifiedCommandTypes = clusterName.split(':');

          // If classified, create command type extraction result directly without calling the function
          commandTypeExtraction = {
            commandTypes: classifiedCommandTypes,
            explanation: `Classified as ${clusterName} command based on semantic similarity.`,
            confidence: 0.9,
          };
        }
      }

      // Step 1: Extract command types (only if not already classified)
      if (!commandTypeExtraction) {
        commandTypeExtraction = await this.extractCommandTypes({
          command,
          conversationHistories,
          currentArtifacts,
        });
      }

      // If no command types were extracted or confidence is very low, return early
      if (commandTypeExtraction.commandTypes.length === 0) {
        return {
          commands: [],
          explanation: commandTypeExtraction.explanation,
          confidence: commandTypeExtraction.confidence,
          lang,
        };
      }

      // If command type is not read or generate, return early
      if (commandTypeExtraction.commandTypes.length === 1) {
        const commandType = commandTypeExtraction.commandTypes[0];

        if (commandType !== 'read' && commandType !== 'generate') {
          return {
            commands: [{ commandType, query: command.query }],
            explanation: commandTypeExtraction.explanation,
            confidence: commandTypeExtraction.confidence,
            lang,
          };
        }
      }

      // Step 2: Extract specific queries for each command type
      logger.log(`Extracting queries for ${commandTypeExtraction.commandTypes.length} command(s)`);

      const queryExtraction = await this.extractQueries({
        command,
        commandTypes: commandTypeExtraction.commandTypes,
        conversationHistories,
        currentArtifacts,
      });

      // Combine the results from both steps
      const result: CommandIntentExtraction = {
        commands: queryExtraction.commands,
        explanation: queryExtraction.explanation,
        confidence: commandTypeExtraction.confidence,
        queryTemplate: commandTypeExtraction.queryTemplate,
        lang,
      };

      // Save the embeddings after both steps are complete
      if (result.confidence >= 0.9 && result.queryTemplate && !ignoreClassify) {
        const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
        const classifier = getClassifier(embeddingSettings, isReloadRequest);

        // Create cluster name from unique command types
        const uniqueCommandTypes = Array.from(new Set(result.commands.map(cmd => cmd.commandType)));
        const newClusterName = uniqueCommandTypes.reduce((acc, curVal) => {
          return acc ? `${acc}:${curVal}` : curVal;
        }, '');

        // Save embedding without awaiting to avoid blocking
        classifier
          .saveEmbedding(result.queryTemplate, newClusterName)
          .then(() => {
            logger.log(`Saved embedding for query template with cluster: ${newClusterName}`);
          })
          .catch(err => {
            logger.error('Failed to save embedding:', err);
          });
      }

      return result;
    } catch (error) {
      logger.error('Error in 2-step intent extraction:', error);
      throw error;
    }
  }

  /**
   * Extract command types from a general query using AI (Step 1)
   * @returns Extracted command types and explanation
   */
  private async extractCommandTypes(args: {
    command: CommandIntent;
    conversationHistories: ConversationHistoryMessage[];
    currentArtifacts?: Artifact[];
  }): Promise<CommandTypeExtraction> {
    const { command, conversationHistories = [], currentArtifacts } = args;

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const additionalSystemPrompts: string[] = command.systemPrompts || [];

    // Proceed with LLM-based command type extraction
    logger.log('Using LLM for command type extraction');

    try {
      // Create an operation-specific abort signal
      const abortSignal = this.plugin.abortService.createAbortController('command-type-extraction');

      const systemPrompts = additionalSystemPrompts.map(content => ({
        role: 'system' as const,
        content,
      }));

      const { object } = await generateObject({
        ...llmConfig,
        abortSignal,
        system: getCommandTypePrompt({
          currentArtifacts,
        }),
        messages: [
          ...systemPrompts,
          ...conversationHistories,
          { role: 'user', content: command.query },
        ],
        schema: commandTypeExtractionSchema,
      });

      return object;
    } catch (error) {
      logger.error('Error extracting command types:', error);
      throw error;
    }
  }

  /**
   * Extract specific queries for each command type using AI (Step 2)
   * @returns Extracted commands with queries
   */
  private async extractQueries(args: {
    command: CommandIntent;
    commandTypes: string[];
    conversationHistories: ConversationHistoryMessage[];
    currentArtifacts?: Artifact[];
  }): Promise<QueryExtraction> {
    const { command, commandTypes, conversationHistories = [], currentArtifacts } = args;

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const additionalSystemPrompts: string[] = command.systemPrompts || [];

    // Proceed with LLM-based query extraction
    logger.log('Using LLM for query extraction');

    try {
      // Create an operation-specific abort signal
      const abortSignal = this.plugin.abortService.createAbortController('query-extraction');

      const systemPrompts = additionalSystemPrompts.map(content => ({
        role: 'system' as const,
        content,
      }));

      const { object } = await generateObject({
        ...llmConfig,
        abortSignal,
        system: getQueryExtractionPrompt({
          commandTypes,
          currentArtifacts,
        }),
        messages: [
          ...systemPrompts,
          ...conversationHistories,
          { role: 'user', content: command.query },
        ],
        schema: queryExtractionSchema,
      });

      return object;
    } catch (error) {
      logger.error('Error extracting queries:', error);
      throw error;
    }
  }

  /**
   * Format extraction explanation as YAML format
   */
  private formatExtractionExplanation(
    extraction: CommandIntentExtraction,
    lang?: string | null
  ): string {
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

IMPORTANT:
- The selection content is included in the user's query, you don't need to read the note again.
- You MUST add a placeholder: ${STW_SELECTED_PLACEHOLDER} to the related command's queries. It will be replaced with the actual selection content to maintain the context.`);
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
      const currentArtifacts = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getAllArtifacts();

      extraction = await this.extractCommandIntent({
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
  }
}
