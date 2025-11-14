import { getTranslation } from 'src/i18n';
import {
  STW_SELECTED_PATTERN,
  IMAGE_LINK_PATTERN,
  WIKI_LINK_PATTERN,
  STW_SELECTED_PLACEHOLDER,
} from 'src/constants';
import { Artifact } from 'src/solutions/artifact';
import { generateObject } from 'ai';
import { getCommandTypePrompt } from './commandTypePrompt';
import { getQueryExtractionPrompt } from './queryExtractionPrompt';
import { logger } from 'src/utils/logger';
import { ConversationHistoryMessage } from 'src/types/types';
import { getClassifier } from 'src/lib/modelfusion/classifiers/getClassifier';
import {
  queryExtractionSchema,
  QueryExtraction,
  IntentTypeExtraction,
  intentTypeExtractionSchema,
} from './zSchemas';
import { SystemPromptModifier } from '../../SystemPromptModifier';
import { stringifyYaml } from 'obsidian';
import { AgentHandlerParams, IntentResultStatus, Intent, AgentResult } from '../../types';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { Agent } from '../../Agent';

export type CommandIntentExtraction = Omit<IntentTypeExtraction, 'types'> &
  Omit<QueryExtraction, 'intents'> & {
    intents: QueryExtraction['intents'];
  };

export class PlannerAgent extends Agent {
  isContentRequired = true;

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
    intent: Intent;
    conversationHistories: ConversationHistoryMessage[];
    lang?: string | null;
    isReloadRequest?: boolean;
    ignoreClassify?: boolean;
    currentArtifacts?: Artifact[];
  }): Promise<CommandIntentExtraction> {
    const {
      intent,
      lang,
      conversationHistories = [],
      isReloadRequest = false,
      ignoreClassify = !this.plugin.settings.embedding.enabled,
      currentArtifacts,
    } = args;

    try {
      logger.log('Starting 2-step intent extraction process');

      // Get classifier for semantic similarity check
      let intentTypeExtraction: IntentTypeExtraction | undefined;

      if (!ignoreClassify) {
        const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
        const classifier = getClassifier(embeddingSettings, isReloadRequest);
        const clusterName = await classifier.doClassify(intent.query);

        if (clusterName) {
          logger.log(`The user input was classified as "${clusterName}"`);
          const classifiedCommandTypes = clusterName.split(':');

          // If classified, create command type extraction result directly without calling the function
          intentTypeExtraction = {
            types: classifiedCommandTypes,
            explanation: `Classified as ${clusterName} command based on semantic similarity.`,
            confidence: 0.9,
          };
        }
      }

      // Step 1: Extract command types (only if not already classified)
      if (!intentTypeExtraction) {
        intentTypeExtraction = await this.extractIntentTypes({
          intent,
          conversationHistories,
          currentArtifacts,
        });
      }

      // If no command types were extracted or confidence is very low, return early
      if (intentTypeExtraction.types.length === 0) {
        return {
          intents: [],
          explanation: intentTypeExtraction.explanation,
          confidence: intentTypeExtraction.confidence,
          lang,
        };
      }

      // If command type is not read or generate, return early
      if (intentTypeExtraction.types.length === 1) {
        const intentType = intentTypeExtraction.types[0];

        if (intentType !== 'read' && intentType !== 'generate') {
          return {
            intents: [{ type: intentType, query: intent.query }],
            explanation: intentTypeExtraction.explanation,
            confidence: intentTypeExtraction.confidence,
            lang,
          };
        }
      }

      // Step 2: Extract specific queries for each command type
      logger.log(
        `Extracting queries for ${joinWithConjunction(intentTypeExtraction.types, 'and')} intent(s)`
      );

      const queryExtraction = await this.extractQueries({
        intent,
        intentTypes: intentTypeExtraction.types,
        conversationHistories,
        currentArtifacts,
      });

      // Combine the results from both steps
      const result: CommandIntentExtraction = {
        intents: queryExtraction.intents,
        explanation: queryExtraction.explanation,
        confidence: intentTypeExtraction.confidence,
        lang,
      };

      return result;
    } catch (error) {
      logger.error('Error in 2-step intent extraction:', error);
      throw error;
    }
  }

  /**
   * Extract intent types from a general query using AI (Step 1)
   * @returns Extracted intent types and explanation
   */
  private async extractIntentTypes(args: {
    intent: Intent;
    conversationHistories: ConversationHistoryMessage[];
    currentArtifacts?: Artifact[];
  }): Promise<IntentTypeExtraction> {
    const { intent, conversationHistories = [], currentArtifacts } = args;

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: intent.model,
      generateType: 'object',
    });

    const additionalSystemPrompts = intent.systemPrompts || [];

    // Proceed with LLM-based intent type extraction
    logger.log('Using LLM for intent type extraction');

    try {
      // Create an operation-specific abort signal
      const abortSignal = this.plugin.abortService.createAbortController('command-type-extraction');
      const modifier = new SystemPromptModifier(additionalSystemPrompts);

      const { object } = await generateObject({
        ...llmConfig,
        abortSignal,
        system: modifier.apply(
          getCommandTypePrompt({
            currentArtifacts,
          })
        ),
        messages: [
          ...modifier
            .getAdditionalSystemPrompts()
            .map(prompt => ({ role: 'system' as const, content: prompt })),
          ...conversationHistories,
          { role: 'user', content: intent.query },
        ],
        schema: intentTypeExtractionSchema,
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
    intent: Intent;
    intentTypes: string[];
    conversationHistories: ConversationHistoryMessage[];
    currentArtifacts?: Artifact[];
  }): Promise<QueryExtraction> {
    const { intent, intentTypes, conversationHistories = [], currentArtifacts } = args;

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: intent.model,
      generateType: 'object',
    });

    const modifier = new SystemPromptModifier(intent.systemPrompts);

    // Proceed with LLM-based query extraction
    logger.log('Using LLM for query extraction');

    try {
      // Create an operation-specific abort signal
      const abortSignal = this.plugin.abortService.createAbortController('query-extraction');

      const { object } = await generateObject({
        ...llmConfig,
        abortSignal,
        system: modifier.apply(
          getQueryExtractionPrompt({
            intentTypes,
            currentArtifacts,
          })
        ),
        messages: [
          ...modifier
            .getAdditionalSystemPrompts()
            .map(prompt => ({ role: 'system' as const, content: prompt })),
          ...conversationHistories,
          { role: 'user', content: intent.query },
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
      intents: extraction.intents.map(intent => ({
        [intent.type]: intent.query,
      })),
    };

    yamlData.explanation = extraction.explanation;
    yamlData.confidence = extraction.confidence;

    // Convert to YAML string
    const yamlContent = stringifyYaml(yamlData);

    return `<a href="javascript:;" class="stw-extraction-details-link">${t('common.extractionDetails')}</a>\n\n\`\`\`yaml\n${yamlContent}\`\`\``;
  }

  /**
   * Handle a general command (space)
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      intentExtractionConfirmed?: boolean;
      extraction?: CommandIntentExtraction;
    } = {}
  ): Promise<AgentResult> {
    const { title, intent, upstreamOptions } = params;

    let extraction = options.extraction;

    // If extraction is not provided, extract conversation history and then get command intent
    if (!extraction) {
      const systemPrompts = intent.systemPrompts || [];
      const conversationHistories = await this.renderer.extractConversationHistory(title);
      const hasStwSelected = new RegExp(STW_SELECTED_PATTERN).test(intent.query);
      const hasImageLinks = new RegExp(IMAGE_LINK_PATTERN).test(intent.query);
      const hasWikiLinks = new RegExp(WIKI_LINK_PATTERN).test(intent.query);

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
        intent: {
          ...intent,
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
    if (this.plugin.settings.llm.showExtractionExplanation && extraction.intents.length > 0) {
      const explanationContent = this.formatExtractionExplanation(extraction, params.lang);
      await this.renderer.updateConversationNote({
        path: title,
        newContent: explanationContent,
        lang: params.lang,
        includeHistory: false,
      });
    }

    if (extraction.intents.length === 0) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        role: 'Steward',
        lang: params.lang,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: 'No intents are extracted',
      };
    }

    // For low confidence intents, return LOW_CONFIDENCE status
    if (extraction.confidence <= 0.7 && !options.intentExtractionConfirmed) {
      return {
        status: IntentResultStatus.LOW_CONFIDENCE,
        intentType: 'general',
        explanation: extraction.explanation,
      };
    }

    // Initialize command execution tracking when high confidence and more than 1 command
    const shouldTrack = extraction.confidence >= 0.9 && extraction.intents.length > 1;

    if (upstreamOptions?.isReloadRequest) {
      // Delete embeddings before resetting
      const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
      const classifier = getClassifier(embeddingSettings, false);

      try {
        await classifier.deleteEmbeddingsByValue(params.intent.query);
        logger.log(`Deleted embeddings for original query when resetting tracking`);
      } catch (error) {
        logger.error('Failed to delete embeddings when resetting tracking:', error);
      }

      await this.plugin.commandTrackingService.resetTracking(title);
    }

    if (shouldTrack) {
      const existingTracking = await this.plugin.commandTrackingService.getTracking(title);

      if (!existingTracking || upstreamOptions?.isReloadRequest) {
        await this.plugin.commandTrackingService.initializeTracking({
          conversationTitle: title,
          originalQuery: intent.query,
          extractedCommands: extraction.intents.map(i => i.type),
          confidence: extraction.confidence,
          isReloadRequest: upstreamOptions?.isReloadRequest,
        });
      }
    }

    // Process the commands (either high confidence or confirmed)
    await this.commandProcessor.processIntents({
      title,
      intents: extraction.intents,
      originalQuery: intent.query,
      lang: extraction.lang,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
