import { App, TFile, TFolder } from 'obsidian';
import { logger } from 'src/utils/logger';
import { DocWithPath } from 'src/types/types';
import { AddInstruction, UpdateInstruction } from 'src/solutions/commands/tools/editContent';
import { getTranslation } from 'src/i18n';

/**
 * Represents a single move operation with v2 parameters
 */
export interface MoveOperation {
  destinationFolder: string;
}

/**
 * Represents an error with path and message
 */
export interface OperationError {
  path: string;
  message: string;
}

/**
 * Represents the extracted move command parameters from a natural language request
 */
export interface MoveQueryExtraction {
  operations: MoveOperation[];
  explanation: string;
  lang?: string;
}

export class ObsidianAPITools {
  constructor(private readonly app: App) {}

  /**
   * Get the new path for a file
   * @param filePath Current path of the file
   * @param newFolderPath Destination folder path
   * @returns New path
   */
  private getNewPath(filePath: string, newFolderPath: string): string {
    const fileName = filePath.split('/').pop();
    return `${newFolderPath}/${fileName}`.replace(/\/+/g, '/');
  }

  /**
   * Move a file to a different location in the vault
   * @param filePath Current path of the file
   * @param newFolderPath Destination folder path
   * @returns Success status and error message if failed
   */
  public async moveFile(
    filePath: string,
    newFolderPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const file = this.app.vault.getFileByPath(filePath);
      if (!file) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      // Ensure the destination folder exists
      await this.ensureFolderExists(newFolderPath);

      // Create the new path (keep the same filename)
      const newPath = this.getNewPath(filePath, newFolderPath);

      // Move the file
      await this.app.fileManager.renameFile(file, newPath);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
      logger.error(`Error moving file ${filePath} to ${newFolderPath}:`, error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Move a folder to a different location in the vault
   * @param folderPath Current path of the folder
   * @param newFolderPath Destination folder path (parent folder)
   * @returns Success status and error message if failed
   */
  public async moveFolder(
    folderPath: string,
    newFolderPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const folder = this.app.vault.getFolderByPath(folderPath);
      if (!folder) {
        return {
          success: false,
          error: `Folder not found: ${folderPath}`,
        };
      }

      // Create the new path (keep the same folder name)
      const folderName = folderPath.split('/').pop();
      const newPath = `${newFolderPath}/${folderName}`.replace(/\/+/g, '/');

      // Normalize paths for comparison
      const normalizedFolderPath = folderPath.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
      const normalizedNewPath = newPath.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');

      // Prevent moving folder into itself or into a subfolder
      if (
        normalizedNewPath === normalizedFolderPath ||
        normalizedNewPath.startsWith(normalizedFolderPath + '/')
      ) {
        const errorMessage = `Cannot move folder into itself or a subfolder: ${newPath}`;
        logger.error(`Cannot move folder ${folderPath} into itself or a subfolder: ${newPath}`);
        return {
          success: false,
          error: errorMessage,
        };
      }

      // Ensure the destination folder exists
      await this.ensureFolderExists(newFolderPath);

      // Check if destination already exists
      if (this.app.vault.getFolderByPath(newPath)) {
        const errorMessage = `Destination folder already exists: ${newPath}`;
        logger.error(`Destination folder already exists: ${newPath}`);
        return {
          success: false,
          error: errorMessage,
        };
      }

      // Move the folder using renameFile (works for folders too)
      await this.app.fileManager.renameFile(folder, newPath);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
      logger.error(`Error moving folder ${folderPath} to ${newFolderPath}:`, error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Ensure a folder exists, creating it if necessary
   * @param folderPath The folder path to ensure exists
   */
  public async ensureFolderExists(folderPath: string): Promise<void> {
    // Skip if folder already exists
    if (this.app.vault.getFolderByPath(folderPath)) {
      return;
    }

    // Create the folder
    logger.log(`Creating folder ${folderPath}`);
    await this.app.vault.createFolder(folderPath);
  }

  /**
   * Move files based on operations and search results
   * @returns Results of the move operations
   */
  async moveByOperations(
    operations: MoveOperation[],
    filesByOperation: Map<number, DocWithPath[]>,
    lang?: string | null
  ): Promise<{
    operations: Array<{
      destinationFolder: string;
      moved: string[];
      errors: OperationError[];
      skipped: string[];
    }>;
    movePairs: Array<[string, string]>; // Array of [originalPath, movedPath] pairs
  }> {
    const t = getTranslation(lang);
    const operationResults = [];
    const movePairs: Array<[string, string]> = [];

    // Process each operation
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      // Get the files for this operation
      const results = filesByOperation.get(i) || [];

      // Process the move operations
      const moved: string[] = [];
      const errors: OperationError[] = [];
      const skipped: string[] = [];

      for (const result of results) {
        const itemPath = result.path;
        if (!itemPath) continue;

        const itemName = itemPath.split('/').pop() || '';
        const destinationPath = `${operation.destinationFolder}/${itemName}`.replace(/\/+/g, '/');

        // Check if file is already in the destination
        const destinationFile = this.app.vault.getFileByPath(destinationPath);
        const destinationFolder = this.app.vault.getFolderByPath(destinationPath);
        if (destinationFile || destinationFolder) {
          errors.push({ path: itemPath, message: t('vault.fileAlreadyInDestination') });
          continue;
        }

        // Determine if this is a file or folder
        const file = this.app.vault.getFileByPath(itemPath);
        const folder = this.app.vault.getFolderByPath(itemPath);

        if (!file && !folder) {
          errors.push({ path: itemPath, message: t('vault.itemNotFound') });
          continue;
        }

        // Move file or folder accordingly
        const result_1 = file
          ? await this.moveFile(itemPath, operation.destinationFolder)
          : await this.moveFolder(itemPath, operation.destinationFolder);

        if (result_1.success) {
          moved.push(destinationPath);
          movePairs.push([itemPath, destinationPath]);
        } else {
          errors.push({
            path: itemPath,
            message: result_1.error || 'Unknown error',
          });
        }
      }

      operationResults.push({
        destinationFolder: operation.destinationFolder,
        moved,
        errors,
        skipped,
      });
    }

    return { operations: operationResults, movePairs };
  }

  /**
   * Copy files based on operations and search results
   * @param operations Array of MoveOperationV2 objects containing destination folders and keywords
   * @param filesByOperation Map of operation index to files to copy
   * @returns Results of the copy operations
   */
  async copyByOperations(
    operations: MoveOperation[],
    filesByOperation: Map<number, DocWithPath[]>
  ): Promise<{
    operations: Array<{
      destinationFolder: string;
      copied: string[];
      errors: OperationError[];
      skipped: string[];
    }>;
  }> {
    const operationResults = [];

    // Process each operation
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      // Get the files for this operation
      const results = filesByOperation.get(i) || [];

      // Process the copy operations
      const copied: string[] = [];
      const errors: OperationError[] = [];
      const skipped: string[] = [];

      for (const result of results) {
        const filePath = result.path;
        if (!filePath) continue;

        const fileName = filePath.split('/').pop() || '';
        const destinationPath = `${operation.destinationFolder}/${fileName}`.replace(/\/+/g, '/');

        // Check if file is already in the destination folder
        if (filePath === destinationPath) {
          skipped.push(filePath);
          continue;
        }

        try {
          // Get the source file
          const sourceFile = this.app.vault.getFileByPath(filePath);
          if (!sourceFile) {
            errors.push({ path: filePath, message: 'File not found' });
            continue;
          }

          // Ensure the destination folder exists
          await this.ensureFolderExists(operation.destinationFolder);

          // Copy the file
          await this.app.vault.copy(sourceFile, destinationPath);
          copied.push(filePath);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
          errors.push({ path: filePath, message: errorMessage });
        }
      }

      operationResults.push({
        destinationFolder: operation.destinationFolder,
        copied,
        errors,
        skipped,
      });
    }

    return { operations: operationResults };
  }

  /**
   * Applies an update instruction to the given content
   */
  public applyUpdateInstruction(content: string, updateInstruction: UpdateInstruction): string {
    let lines = content.split('\n');

    switch (updateInstruction.type) {
      case 'replace': {
        // Extract the original content from the specified lines (0-based indexing)
        const startLine = Math.max(0, updateInstruction.fromLine);
        const endLine = Math.min(lines.length - 1, updateInstruction.toLine);

        if (startLine > endLine) {
          throw new Error(
            `Invalid line range: fromLine ${updateInstruction.fromLine} > toLine ${updateInstruction.toLine}`
          );
        }

        const originalContent = lines.slice(startLine, endLine + 1).join('\n');
        content = content.replace(originalContent, updateInstruction.new);
        break;
      }
      case 'add': {
        const addInstruction = updateInstruction as AddInstruction;
        if (addInstruction.position === 'beginning') {
          content = addInstruction.content + ' ' + content;
        } else if (addInstruction.position === 'end') {
          content = content.endsWith('\n')
            ? content + addInstruction.content
            : content + '\n' + addInstruction.content;
        } else if (typeof addInstruction.position === 'number') {
          const position = Math.max(0, Math.min(addInstruction.position, lines.length));
          lines.splice(position, 0, addInstruction.content);
          content = lines.join('\n');
        } else {
          throw new Error('Invalid position value for add instruction');
        }
        break;
      }
      default: {
        const unknownInstruction = updateInstruction as { type: string };
        throw new Error(`Unsupported update type: ${unknownInstruction.type}`);
      }
    }

    lines = content.trim().split('\n');

    // Remove empty trailing and leading lines, and add a newline to the end of the content
    while (lines[0].trim() === '') {
      lines.shift();
    }
    while (lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Get all files from a folder recursively.
   * Similar to VaultList's approach but collects files recursively.
   */
  public getFilesFromFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile) {
        files.push(child);
      } else if (child instanceof TFolder) {
        // Recursively process subfolders
        files.push(...this.getFilesFromFolder(child));
      }
    }

    return files;
  }

  /**
   * Resolve file patterns to actual file paths.
   * Patterns are treated as RegExp strings (case-insensitive), similar to VaultList.
   * If a pattern fails to compile as regex, it's treated as a literal path.
   *
   * @param patterns Array of file patterns to resolve
   * @param folder Optional folder path to limit search scope. If provided, only files in this folder (and subfolders) are matched.
   * @returns Array of file paths matching the patterns
   */
  public resolveFilePatterns(patterns: string[], folder?: string): string[] {
    let filesToSearch: TFile[];

    // If folder is specified, collect files from folder.children recursively
    if (folder) {
      const folderPath = folder.trim().replace(/^\/+|\/+$/g, '');
      const targetFolder = this.app.vault.getFolderByPath(folderPath);
      if (!targetFolder) {
        // Folder doesn't exist, return empty array
        return [];
      }

      // Collect files from folder.children recursively (like VaultList does)
      filesToSearch = this.getFilesFromFolder(targetFolder);
    } else {
      // No folder specified, search entire vault
      filesToSearch = this.app.vault.getFiles();
    }

    const matchedPaths = new Set<string>();

    for (const pattern of patterns) {
      const trimmedPattern = pattern.trim();
      if (!trimmedPattern) {
        continue;
      }

      // Try to match as regex pattern first (like VaultList does)
      try {
        const regex = new RegExp(trimmedPattern, 'i');
        for (const file of filesToSearch) {
          if (regex.test(file.path) || regex.test(file.name)) {
            matchedPaths.add(file.path);
          }
        }
      } catch (error) {
        // If regex is invalid, treat as literal path
        const file = this.app.vault.getFileByPath(trimmedPattern);
        if (file && (!folder || file.path.startsWith(folder))) {
          matchedPaths.add(file.path);
        }
      }
    }

    return Array.from(matchedPaths);
  }
}
