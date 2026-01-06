import { App, TFile } from 'obsidian';
import { logger } from '../utils/logger';
import { SearchService } from 'src/solutions/search/searchService';

export class MediaTools {
  private readonly mediaFolder: string;
  private static instance: MediaTools | null = null;

  /**
   * Get the singleton instance of MediaTools
   * @param app The Obsidian App instance
   * @returns MediaTools instance
   */
  public static getInstance(app?: App): MediaTools {
    if (app) {
      MediaTools.instance = new MediaTools(app);
      return MediaTools.instance;
    }
    if (!MediaTools.instance) {
      throw new Error('App is required');
    }
    return MediaTools.instance;
  }

  private constructor(private readonly app: App) {
    this.mediaFolder = this.getAttachmentsFolderPath();
  }

  /**
   * Get the attachments folder path from Obsidian settings
   */
  public getAttachmentsFolderPath(): string {
    // @ts-ignore - Accessing internal Obsidian API
    const attachmentsFolder = this.app.vault.config.attachmentFolderPath;
    return attachmentsFolder || 'attachments';
  }

  /**
   * Find a file by name or path
   * @param nameOrPath - File name or path
   * @returns The found TFile or null if not found
   */
  async findFileByNameOrPath(nameOrPath: string): Promise<TFile | null> {
    // Strategy 1: Try direct path lookup
    const file = this.app.vault.getFileByPath(nameOrPath);
    if (file) {
      return file;
    }

    // Extract filename from path if provided
    const filename = nameOrPath.includes('/')
      ? nameOrPath.split('/').pop() || nameOrPath
      : nameOrPath;

    const searchService = SearchService.getInstance();
    const isIndexBuilt = await searchService.documentStore.isIndexBuilt();

    if (isIndexBuilt) {
      // Strategy 2: Use the search service to find the document by name
      const result = await searchService.getFileByName(filename);

      if (result && result.document.path) {
        const foundFile = this.app.vault.getFileByPath(result.document.path);
        if (foundFile) {
          return foundFile;
        }
      }
    } else {
      // Strategy 3: Scan all files when index is not built
      const allFiles = this.app.vault.getFiles();
      const lowerFilename = filename.toLowerCase();

      // Check if filename has an extension
      const lastDotIndex = filename.lastIndexOf('.');
      const hasExtension = lastDotIndex > 0 && lastDotIndex < filename.length - 1;
      const filenameWithoutExt = hasExtension
        ? filename.substring(0, lastDotIndex).toLowerCase()
        : lowerFilename;

      // First, try exact match (case-insensitive)
      for (const vaultFile of allFiles) {
        if (hasExtension) {
          // If search term has extension, compare with extension
          if (vaultFile.name.toLowerCase() === lowerFilename) {
            return vaultFile;
          }
        } else {
          // If search term has no extension, compare without extension using basename
          if (vaultFile.basename.toLowerCase() === filenameWithoutExt) {
            return vaultFile;
          }
        }
      }
    }

    return null;
  }

  /**
   * Ensure the media folder exists
   */
  public async ensureMediaFolderExists(): Promise<void> {
    const folder = this.app.vault.getFolderByPath(this.mediaFolder);
    if (!folder) {
      await this.app.vault.createFolder(this.mediaFolder);
    }
  }

  /**
   * Generate a filename for the media file, including prompt if <= maxWords words
   */
  public getMediaFilename(
    prompt: string,
    type: 'image' | 'audio',
    timestamp: number,
    maxWords = 3
  ): string {
    if (prompt && prompt.trim().split(/\s+/).length <= maxWords) {
      // Replace only special characters, preserving letters (including diacritics) and numbers
      const sanitizedPrompt = prompt.replace(/[^\p{L}\p{N}]+/gu, '-');
      return `${type}_${sanitizedPrompt}_${timestamp}`;
    } else {
      return `${type}_${timestamp}`;
    }
  }

  /**
   * Delete a media file
   */
  async deleteMediaFile(filePath: string): Promise<boolean> {
    try {
      const file = await this.findFileByNameOrPath(filePath);
      if (file) {
        await this.app.fileManager.trashFile(file);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error deleting media file:', error);
      return false;
    }
  }
}
