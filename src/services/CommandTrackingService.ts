import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import type { TFile } from 'obsidian';

/**
 * Represents the tracking data stored in frontmatter
 */
interface Tracking {
  /**
   * The original query from the user
   */
  originalQuery: string;
  /**
   * Commands extracted by the general command handler
   */
  extractedCommands: string[];
  /**
   * Commands that were actually executed (including dynamically called ones)
   */
  executedCommands: string[];
  /**
   * Confidence score from the extraction
   */
  confidence?: number;
  /**
   * Whether the tracking is for a reload request
   */
  isReloadRequest?: boolean;
}

/**
 * Service for tracking command execution in conversation frontmatter
 * This allows us to learn from actual command execution patterns for better classification
 */
export class CommandTrackingService {
  private static instance: CommandTrackingService | null = null;

  private constructor(private plugin: StewardPlugin) {}

  static getInstance(plugin?: StewardPlugin): CommandTrackingService {
    if (plugin) {
      CommandTrackingService.instance = new CommandTrackingService(plugin);
      return CommandTrackingService.instance;
    }

    if (!CommandTrackingService.instance) {
      throw new Error('CommandTrackingService not initialized');
    }

    return CommandTrackingService.instance;
  }

  /**
   * Get the conversation file
   */
  private getConversationFile(conversationTitle: string): TFile | null {
    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${conversationTitle}.md`;
    return this.plugin.app.vault.getFileByPath(notePath);
  }

  /**
   * Initialize tracking for a conversation
   * This should be called when the general command handler starts processing
   */
  public async initializeTracking(params: {
    conversationTitle: string;
    originalQuery: string;
    extractedCommands: string[];
    confidence?: number;
    isReloadRequest?: boolean;
  }): Promise<void> {
    const { conversationTitle, originalQuery, extractedCommands, confidence, isReloadRequest } =
      params;

    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      logger.error(`Note not found: ${conversationTitle}`);
      return;
    }

    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      frontmatter.tracking = {
        originalQuery,
        extractedCommands,
        executedCommands: [],
        confidence,
        isReloadRequest,
      };
    });

    logger.log(`Initialized tracking for: ${conversationTitle}`, extractedCommands);
  }

  /**
   * Record a command execution
   * This should be called whenever a command handler is executed
   */
  public async recordCommandExecution(
    conversationTitle: string,
    commandType: string
  ): Promise<void> {
    const file = this.getConversationFile(conversationTitle);
    if (!file) {
      return;
    }

    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      if (!frontmatter.tracking) {
        // Tracking not initialized, skip
        return;
      }

      const tracking = frontmatter.tracking;

      // Add command to executed commands (avoid duplicates by using Set logic)
      if (!tracking.executedCommands) {
        tracking.executedCommands = [];
      }

      // Only add if not already present
      if (!tracking.executedCommands.includes(commandType)) {
        tracking.executedCommands.push(commandType);
      }

      frontmatter.tracking = tracking;
    });

    logger.log(`Recorded command execution: "${commandType}" for ${conversationTitle}`);
  }

  /**
   * Get the current tracking state
   */
  public async getTracking(
    conversationTitle: string,
    forceRefresh?: boolean
  ): Promise<Tracking | null> {
    const tracking = await this.plugin.conversationRenderer.getConversationProperty<Tracking>(
      conversationTitle,
      'tracking',
      forceRefresh
    );

    return tracking || null;
  }
}
