import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

/**
 * Interface for tracking model fallback state in frontmatter
 */
export interface ModelFallbackFrontmatter {
  originalModel?: string;
  attemptedModels?: string[];
  errors?: Array<{ model: string; error: string }>;
}

/**
 * Service for managing model fallback
 */
export class ModelFallbackService {
  private static instance: ModelFallbackService | null = null;

  private constructor(private plugin: StewardPlugin) {}

  /**
   * Get the singleton instance
   */
  public static getInstance(plugin?: StewardPlugin): ModelFallbackService {
    if (plugin) {
      ModelFallbackService.instance = new ModelFallbackService(plugin);
    }

    if (!ModelFallbackService.instance) {
      throw new Error('ModelFallbackService is not initialized');
    }

    return ModelFallbackService.instance;
  }

  /**
   * Check if model fallback is enabled in settings
   */
  public isEnabled(): boolean {
    return this.plugin.settings.llm.modelFallback?.enabled ?? false;
  }

  /**
   * Get the conversation file
   */
  private getConversationFile(conversationTitle: string): TFile | null {
    const notePath = `${this.plugin.settings.stewardFolder}/Conversations/${conversationTitle}.md`;
    return this.plugin.app.vault.getFileByPath(notePath);
  }

  /**
   * Initialize the model fallback state for a command
   * Only initializes if state doesn't exist yet
   */
  public async initializeState(conversationTitle: string, originalModel: string): Promise<void> {
    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      logger.error(`Note not found: ${conversationTitle}`);
      return;
    }

    // Check if state already exists
    const state = await this.getState(conversationTitle);
    if (state) {
      // State already exists, don't overwrite it
      return;
    }

    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      frontmatter.model = originalModel;
      frontmatter.modelFallback = {
        originalModel,
        attemptedModels: [originalModel],
      };
    });
  }

  /**
   * Get the current model from frontmatter
   */
  public async getCurrentModel(conversationTitle: string): Promise<string | null> {
    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      return null;
    }

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.model || null;
  }

  /**
   * Get the current model fallback state from frontmatter
   */
  public async getState(conversationTitle: string): Promise<ModelFallbackFrontmatter | null> {
    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      return null;
    }

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter?.modelFallback) {
      return null;
    }

    return cache.frontmatter.modelFallback;
  }

  /**
   * Check if there are more fallback models available
   */
  public async hasMoreFallbacks(conversationTitle: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const state = await this.getState(conversationTitle);
    if (!state || !state.attemptedModels) {
      return false;
    }

    const fallbackChain = this.plugin.settings.llm.modelFallback?.fallbackChain || [];
    if (fallbackChain.length === 0) {
      return false;
    }

    // Check if there are models in the fallback chain that haven't been attempted yet
    return fallbackChain.some(model => !state.attemptedModels?.includes(model));
  }

  /**
   * Check if a specific model has already failed in this conversation
   */
  public async hasModelFailed(conversationTitle: string, model: string): Promise<boolean> {
    const state = await this.getState(conversationTitle);
    if (!state || !state.errors) {
      return false;
    }

    return state.errors.some(error => error.model === model);
  }

  /**
   * Get the next model from the fallback chain
   */
  private async getNextModel(conversationTitle: string): Promise<string | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const state = await this.getState(conversationTitle);
    if (!state || !state.attemptedModels) {
      return null;
    }

    const fallbackChain = this.plugin.settings.llm.modelFallback?.fallbackChain || [];
    if (fallbackChain.length === 0) {
      return null;
    }

    // Find the first model in the fallback chain that hasn't been attempted yet
    return fallbackChain.find(model => !state.attemptedModels?.includes(model)) || null;
  }

  /**
   * Switch to the next fallback model
   */
  public async switchToNextModel(conversationTitle: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      return false;
    }

    const state = await this.getState(conversationTitle);
    if (!state) {
      return false;
    }

    const nextModel = await this.getNextModel(conversationTitle);
    if (!nextModel) {
      return false;
    }

    // Update the frontmatter
    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      // Update the main model field
      frontmatter.model = nextModel;

      if (!frontmatter.modelFallback) {
        return;
      }

      if (!frontmatter.modelFallback.attemptedModels) {
        frontmatter.modelFallback.attemptedModels = [];
      }

      frontmatter.modelFallback.attemptedModels.push(nextModel);
    });

    // Update usedModels in frontmatter
    await this.trackModelInFrontmatter(conversationTitle, nextModel);

    return true;
  }

  /**
   * Get all recorded errors for a conversation
   */
  public async getRecordedErrors(
    conversationTitle: string
  ): Promise<Array<{ model: string; error: string }>> {
    const state = await this.getState(conversationTitle);
    if (!state || !state.errors) {
      return [];
    }

    return state.errors;
  }

  /**
   * Get a user-friendly display name for a model ID
   */
  private getModelDisplayName(modelId: string): string {
    if (!modelId || !modelId.includes(':')) {
      return modelId;
    }

    const [provider, model] = modelId.split(':');
    return `${provider} ${model}`;
  }

  /**
   * Track the used model in the conversation frontmatter
   */
  private async trackModelInFrontmatter(conversationTitle: string, model: string): Promise<void> {
    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      return;
    }

    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      if (!frontmatter.usedModels) {
        frontmatter.usedModels = [model];
        return;
      }

      // Handle both array and string formats
      let usedModels: string[] = [];
      if (Array.isArray(frontmatter.usedModels)) {
        usedModels = frontmatter.usedModels;
      } else if (typeof frontmatter.usedModels === 'string') {
        usedModels = frontmatter.usedModels
          .replace(/[[\]]/g, '')
          .split(',')
          .map((m: string) => m.trim())
          .filter((m: string) => m.length > 0);
      }

      // Add the new model if it's not already in the array
      if (!usedModels.includes(model)) {
        usedModels.push(model);
      }

      frontmatter.usedModels = usedModels;
    });
  }

  /**
   * Clear the fallback state
   */
  public async clearState(conversationTitle: string): Promise<void> {
    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      return;
    }

    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      if (frontmatter.modelFallback) {
        delete frontmatter.modelFallback;
      }
    });
  }
}
