import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

export type TrashFile = { originalPath: string; trashPath: string };
export type NonTrashFile = { originalPath: string; trashPath?: string };

/**
 * Interface for trash metadata
 */
export interface TrashMetadata {
  files: Record<
    string,
    {
      originalPath: string;
      deletedAt: number;
      artifactId?: string;
    }
  >;
}

/**
 * Service to manage trash cleanup based on the cleanup policy
 */
export class TrashCleanupService {
  private metadataFile = 'trash-metadata.json';
  private cleanupIntervalId: number | null = null;
  private readonly CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Initialize the cleanup service
   */
  async initialize(): Promise<void> {
    // Run initial cleanup
    await this.runCleanup();

    // Set up daily cleanup check
    this.cleanupIntervalId = window.setInterval(() => {
      this.runCleanup();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Cleanup resources when plugin unloads
   */
  cleanup(): void {
    if (this.cleanupIntervalId !== null) {
      window.clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Get the path to the trash folder
   */
  private getTrashFolderPath(): string {
    return `${this.plugin.settings.stewardFolder}/Trash`;
  }

  /**
   * Get the path to the metadata file
   */
  private getMetadataFilePath(): string {
    return `${this.getTrashFolderPath()}/${this.metadataFile}`;
  }

  /**
   * Load trash metadata from file
   */
  private async loadMetadata(): Promise<TrashMetadata> {
    const metadataPath = this.getMetadataFilePath();

    try {
      const file = this.plugin.app.vault.getFileByPath(metadataPath);
      if (!file) {
        return { files: {} };
      }

      const content = await this.plugin.app.vault.read(file);
      return JSON.parse(content);
    } catch (error) {
      logger.error('Error loading trash metadata:', error);
      return { files: {} };
    }
  }

  /**
   * Save trash metadata to file
   */
  private async saveMetadata(metadata: TrashMetadata): Promise<void> {
    const metadataPath = this.getMetadataFilePath();
    const trashFolder = this.getTrashFolderPath();

    try {
      // Ensure trash folder exists using ObsidianAPITools
      await this.plugin.obsidianAPITools.ensureFolderExists(trashFolder);

      const content = JSON.stringify(metadata, null, 2);
      const file = this.plugin.app.vault.getFileByPath(metadataPath);

      if (file) {
        await this.plugin.app.vault.modify(file, content);
      } else {
        await this.plugin.app.vault.create(metadataPath, content);
      }
    } catch (error) {
      logger.error('Error saving trash metadata:', error);
    }
  }

  /**
   * Add multiple files to the trash metadata at once
   */
  async addFilesToTrash(params: { files: TrashFile[]; artifactId: string }): Promise<void> {
    if (params.files.length === 0) {
      return;
    }

    const metadata = await this.loadMetadata();
    const deletedAt = Date.now();

    for (const file of params.files) {
      metadata.files[file.trashPath] = {
        originalPath: file.originalPath,
        deletedAt,
        artifactId: params.artifactId,
      };
    }

    await this.saveMetadata(metadata);
  }

  /**
   * Remove a file from the trash metadata
   */
  async removeFileFromTrash(trashPath: string): Promise<void> {
    const metadata = await this.loadMetadata();

    if (metadata.files[trashPath]) {
      delete metadata.files[trashPath];
      await this.saveMetadata(metadata);
    }
  }

  /**
   * Get the age threshold in milliseconds based on cleanup policy
   */
  private getAgeThreshold(): number | null {
    const { cleanupPolicy } = this.plugin.settings.deleteBehavior;

    if (!cleanupPolicy || cleanupPolicy === 'never') {
      return null;
    }

    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    switch (cleanupPolicy) {
      case '7days':
        return now - 7 * dayInMs;
      case '30days':
        return now - 30 * dayInMs;
      case '90days':
        return now - 90 * dayInMs;
      case '1year':
        return now - 365 * dayInMs;
      default:
        return null;
    }
  }

  /**
   * Run the cleanup process
   */
  async runCleanup(): Promise<void> {
    // Only cleanup if behavior is stw_trash
    if (this.plugin.settings.deleteBehavior.behavior !== 'stw_trash') {
      return;
    }

    const ageThreshold = this.getAgeThreshold();
    if (ageThreshold === null) {
      return;
    }

    logger.log('Running trash cleanup...');

    const metadata = await this.loadMetadata();
    const filesToDelete: string[] = [];

    // Find files that exceed the age threshold
    for (const [trashPath, fileInfo] of Object.entries(metadata.files)) {
      if (fileInfo.deletedAt < ageThreshold) {
        filesToDelete.push(trashPath);
      }
    }

    if (filesToDelete.length === 0) {
      logger.log('No files to cleanup');
      return;
    }

    // Delete files permanently
    let deletedCount = 0;
    for (const trashPath of filesToDelete) {
      const success = await this.permanentlyDeleteFile(trashPath);
      if (success) {
        delete metadata.files[trashPath];
        deletedCount++;
      }
    }

    // Save updated metadata
    await this.saveMetadata(metadata);

    logger.log(`Cleanup completed: ${deletedCount} files permanently deleted`);
  }

  /**
   * Permanently delete a file from the vault
   */
  private async permanentlyDeleteFile(filePath: string): Promise<boolean> {
    try {
      const file = this.plugin.app.vault.getFileByPath(filePath);
      if (!file) {
        logger.warn(`File not found for permanent deletion: ${filePath}`);
        return true; // Consider it deleted if it doesn't exist
      }

      await this.plugin.app.fileManager.trashFile(file);
      logger.log(`Permanently deleted: ${filePath}`);
      return true;
    } catch (error) {
      logger.error(`Error permanently deleting file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Get trash metadata for a specific file
   */
  async getFileMetadata(trashPath: string): Promise<{
    originalPath: string;
    deletedAt: number;
    artifactId?: string;
  } | null> {
    const metadata = await this.loadMetadata();
    return metadata.files[trashPath] || null;
  }

  /**
   * Get all trash metadata
   */
  async getAllMetadata(): Promise<TrashMetadata> {
    return this.loadMetadata();
  }
}
