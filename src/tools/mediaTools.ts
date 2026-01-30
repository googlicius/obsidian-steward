import { App, TFile, TFolder } from 'obsidian';
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
   * Parse a file name or path into its components
   * @param nameOrPath - File name or path (e.g., "folder/subfolder/file.md" or "file.md")
   * @returns Object containing path, name, basename, and extension
   */
  private parseFilePath(nameOrPath: string): {
    path: string | null;
    name: string;
    basename: string;
    extension: string | null;
  } {
    const hasPath = nameOrPath.includes('/');
    const name = hasPath ? nameOrPath.split('/').pop() || nameOrPath : nameOrPath;
    const path = hasPath ? nameOrPath.substring(0, nameOrPath.lastIndexOf('/')) : null;

    const lastDotIndex = name.lastIndexOf('.');
    const hasExtension = lastDotIndex > 0 && lastDotIndex < name.length - 1;
    const extension = hasExtension ? name.substring(lastDotIndex + 1) : null;
    const basename = hasExtension ? name.substring(0, lastDotIndex) : name;

    return {
      path,
      name,
      basename,
      extension,
    };
  }

  /**
   * Get all files from a folder (non-recursive)
   * @param folder - The folder to get files from
   * @returns Array of TFile objects in the folder
   */
  private getFilesFromFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile) {
        files.push(child);
      }
    }

    return files;
  }

  /**
   * Find a file by name or path
   * @param nameOrPath - File name or path (fragments like #page=5 are stripped; they do not exist on disk)
   * @returns The found TFile or null if not found
   */
  async findFileByNameOrPath(nameOrPath: string): Promise<TFile | null> {
    // Strip fragment (e.g. #page=5) – the path physically does not exist
    const pathWithoutFragment = nameOrPath.includes('#')
      ? nameOrPath.slice(0, nameOrPath.indexOf('#'))
      : nameOrPath;

    // Strategy 1: Try direct path lookup
    const file = this.app.vault.getFileByPath(pathWithoutFragment);
    if (file) {
      return file;
    }

    // Parse the path without fragment into components
    const parsed = this.parseFilePath(pathWithoutFragment);
    const { path: folderPath, name, basename, extension } = parsed;

    const searchService = SearchService.getInstance();
    const isIndexBuilt = await searchService.documentStore.isIndexBuilt();

    if (isIndexBuilt) {
      // Strategy 2: Use the search service to find the document by name
      const result = await searchService.getFileByName(name);

      if (result && result.document.path) {
        const foundFile = this.app.vault.getFileByPath(result.document.path);
        if (foundFile) {
          // If folder path was provided, verify the file is in that folder
          if (!folderPath || foundFile.path.startsWith(folderPath + '/')) {
            return foundFile;
          }
        }
      }
    } else {
      // Strategy 3: Scan files when index is not built
      // If folder path is provided, only scan files in that folder
      const filesToScan = folderPath
        ? (() => {
            const folder = this.app.vault.getFolderByPath(folderPath);
            return folder ? this.getFilesFromFolder(folder) : [];
          })()
        : this.app.vault.getFiles();

      const lowerName = name.toLowerCase();
      const lowerBasename = basename.toLowerCase();
      const hasExtension = extension !== null;

      // Try exact match (case-insensitive)
      for (const vaultFile of filesToScan) {
        if (hasExtension) {
          // If search term has extension, compare with extension
          if (vaultFile.name.toLowerCase() === lowerName) {
            return vaultFile;
          }
        } else {
          // If search term has no extension, compare without extension using basename
          if (vaultFile.basename.toLowerCase() === lowerBasename) {
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
