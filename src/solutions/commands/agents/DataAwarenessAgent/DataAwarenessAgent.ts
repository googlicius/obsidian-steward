import { generateObject } from 'ai';
import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { DocWithPath } from 'src/types/types';
import { logger } from 'src/utils/logger';
import { getTranslation } from 'src/i18n';

export interface DataAwarenessResult<T = unknown> {
  /**
   * Processed results matching the response schema
   */
  results: T[];
  /**
   * Files that were successfully processed
   */
  processedFiles: string[];
  /**
   * Files that failed to process
   */
  failedFiles: Array<{ path: string; error: string }>;
  /**
   * Total number of files processed
   */
  totalProcessed: number;
}

interface DataAwarenessAgentParams {
  /**
   * The plugin instance
   */
  plugin: StewardPlugin;
  /**
   * System prompt to instruct the LLM on how to process the data
   */
  systemPrompt: string;
  /**
   * Zod schema defining the expected response format
   */
  responseSchema: z.ZodSchema;
  /**
   * Function to extract results from the generated object
   */
  extractResults: <T>(object: unknown) => T[];
}

/**
 * Helper agent for processing tasks in batches that need to be aware of the input data,
 * to process a large number of files without hitting token limits.
 */
export class DataAwarenessAgent {
  private readonly DEFAULT_BATCH_SIZE = 30;
  private readonly plugin: StewardPlugin;
  private readonly systemPrompt: string;
  private readonly responseSchema: z.ZodSchema;
  private readonly extractResults: <T = unknown>(object: unknown) => T[];

  constructor(params: DataAwarenessAgentParams) {
    this.plugin = params.plugin;
    this.systemPrompt = params.systemPrompt;
    this.responseSchema = params.responseSchema;
    this.extractResults = params.extractResults;
  }

  /**
   * Process files and extract data based on the query and response format
   */
  public async process<T = unknown>(options: {
    /**
     * Query describing what data to extract or process from the files
     */
    query: string;
    /**
     * Artifact ID to get files from
     */
    artifactId: string;
    /**
     * Title of the conversation
     */
    title: string;
    /**
     * Whether to process files in parallel (default: false, sequential)
     */
    parallel?: boolean;
    /**
     * Maximum number of files to process in a single batch
     */
    batchSize?: number;
    /**
     * Model to use for processing (optional, uses default if not provided)
     */
    model?: string;
    /**
     * Language for rendering messages
     */
    lang?: string | null;
    /**
     * Handler ID for grouping messages
     */
    handlerId?: string;
  }): Promise<DataAwarenessResult<T>> {
    const {
      query,
      artifactId,
      title,
      parallel = false,
      batchSize = this.DEFAULT_BATCH_SIZE,
      model,
      lang,
      handlerId,
    } = options;

    const t = getTranslation(lang);

    // Resolve files from artifact
    const resolvedFiles = await this.plugin.artifactManagerV2
      .withTitle(title)
      .resolveFilesFromArtifact(artifactId);

    if (resolvedFiles.length === 0) {
      logger.warn('No files found for data awareness processing');
      return {
        results: [],
        processedFiles: [],
        failedFiles: [],
        totalProcessed: 0,
      };
    }

    // Process files in batches
    const batches = this.createBatches(resolvedFiles, batchSize);
    const allResults: T[] = [];
    const processedFiles: string[] = [];
    const failedFiles: Array<{ path: string; error: string }> = [];

    if (parallel) {
      // Process batches in parallel
      if (batches.length > 1 && handlerId) {
        const t = getTranslation(lang);
        await this.plugin.conversationRenderer.updateConversationNote({
          path: title,
          newContent: `*${t('conversation.processingBatch', {
            current: 1,
            total: batches.length,
          })}*`,
          agent: 'data-awareness',
          lang,
          handlerId,
          includeHistory: false,
        });
      }

      const batchPromises = batches.map(batch =>
        this.processBatch<T>({
          batch,
          query,
          model,
        })
      );

      const batchResults = await Promise.all(batchPromises);

      for (const batchResult of batchResults) {
        allResults.push(...batchResult.results);
        processedFiles.push(...batchResult.processedFiles);
        failedFiles.push(...batchResult.failedFiles);
      }
    } else {
      // Process batches sequentially (default)
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        // Render batch processing message
        if (batches.length > 1 && handlerId) {
          await this.plugin.conversationRenderer.updateConversationNote({
            path: title,
            newContent: `*${t('conversation.processingBatch', {
              current: i + 1,
              total: batches.length,
            })}*`,
            agent: 'data-awareness',
            lang,
            handlerId,
            includeHistory: false,
          });
        }

        const batchResult = await this.processBatch<T>({
          batch,
          query,
          model,
        });

        allResults.push(...batchResult.results);
        processedFiles.push(...batchResult.processedFiles);
        failedFiles.push(...batchResult.failedFiles);
      }
    }

    return {
      results: allResults,
      processedFiles,
      failedFiles,
      totalProcessed: processedFiles.length,
    };
  }

  /**
   * Create batches from files
   */
  private createBatches(files: DocWithPath[], batchSize: number): DocWithPath[][] {
    const batches: DocWithPath[][] = [];

    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Process a single batch of files
   */
  private async processBatch<T = unknown>(params: {
    batch: DocWithPath[];
    query: string;
    model?: string;
  }): Promise<{
    results: T[];
    processedFiles: string[];
    failedFiles: Array<{ path: string; error: string }>;
  }> {
    const { batch, query } = params;

    // Build context from file paths
    const context = this.buildContext(batch);

    // Process with LLM
    try {
      const llmConfig = await this.plugin.llmService.getLLMConfig({
        overrideModel: params.model,
        generateType: 'object',
      });

      const userMessage = `${query}

Files to process:
${context}

Return the results in the exact format specified by the response schema.`;

      const model = llmConfig.model;

      if (model.specificationVersion === 'v3') {
        throw Error('Object generation is currently not supported for v3 models');
      }

      const result = await generateObject({
        ...llmConfig,
        model,
        abortSignal: this.plugin.abortService.createAbortController('data-awareness'),
        schema: this.responseSchema,
        system: this.systemPrompt,
        prompt: userMessage,
      });

      // Extract results from the generated object
      // The result.object should match the response schema structure
      const results = this.extractResults<T>(result.object);

      return {
        results,
        processedFiles: batch.map(f => f.path),
        failedFiles: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing batch with LLM:', error);

      // Return all files as failed
      const allFailedFiles = batch.map(f => ({
        path: f.path,
        error: errorMessage,
      }));

      return {
        results: [],
        processedFiles: [],
        failedFiles: allFailedFiles,
      };
    }
  }

  /**
   * Build context string from file paths
   */
  private buildContext(files: DocWithPath[]): string {
    const contextParts: string[] = [];

    for (const file of files) {
      contextParts.push(`- ${file.path}`);
    }

    return contextParts.join('\n');
  }
}
