import { App } from 'obsidian';
import { IndexedDocument } from 'src/database/SearchDatabase';
import {
  UpdateInstruction,
  ReplaceInstruction,
  AddInstruction,
} from '../lib/modelfusion/extractions';
import { SearchOperationV2 } from 'src/lib/modelfusion';

/**
 * Represents a single move operation with v2 parameters
 */
export interface MoveOperationV2 extends SearchOperationV2 {
  destinationFolder: string;
}

/**
 * Represents a single move operation
 */
export interface MoveOperation {
  sourceQuery: string;
  destinationFolder: string;
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
   * @returns Success or failure
   */
  private async moveFile(filePath: string, newFolderPath: string): Promise<boolean> {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file) {
        return false;
      }

      // Ensure the destination folder exists
      await this.ensureFolderExists(newFolderPath);

      // Create the new path (keep the same filename)
      const newPath = this.getNewPath(filePath, newFolderPath);

      // Move the file
      await this.app.fileManager.renameFile(file, newPath);
      return true;
    } catch (error) {
      console.error(`Error moving file ${filePath} to ${newFolderPath}:`, error);
      return false;
    }
  }

  /**
   * Ensure a folder exists, creating it if necessary
   * @param folderPath The folder path to ensure exists
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    // Skip if folder already exists
    if (this.app.vault.getAbstractFileByPath(folderPath)) {
      return;
    }

    // Create the folder
    await this.app.vault.createFolder(folderPath);
  }

  /**
   * Move files based on operations and search results
   * @param operations Array of MoveOperationV2 objects containing destination folders and keywords
   * @param filesByOperation Map of operation index to files to move
   * @returns Results of the move operations
   */
  async moveByOperations(
    operations: MoveOperationV2[],
    filesByOperation: Map<number, IndexedDocument[]>
  ): Promise<{
    operations: Array<{
      sourceQuery: string;
      destinationFolder: string;
      moved: string[];
      errors: string[];
      skipped: string[];
    }>;
  }> {
    const operationResults = [];

    // Process each operation
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      // Get the files for this operation
      const results = filesByOperation.get(i) || [];

      // Process the move operations
      const moved: string[] = [];
      const errors: string[] = [];
      const skipped: string[] = [];

      for (const result of results) {
        const filePath = result.path;
        if (!filePath) continue;

        const destinationPath = this.getNewPath(filePath, operation.destinationFolder);

        // Check if file is already in the destination folder
        if (filePath === destinationPath) {
          skipped.push(filePath);
          continue;
        }

        const success = await this.moveFile(filePath, operation.destinationFolder);

        if (success) {
          moved.push(destinationPath);
        } else {
          errors.push(filePath);
        }
      }

      operationResults.push({
        sourceQuery: operation.keywords ? operation.keywords.join(', ') : 'Search results',
        destinationFolder: operation.destinationFolder,
        moved,
        errors,
        skipped,
      });
    }

    return { operations: operationResults };
  }

  /**
   * Copy files based on operations and search results
   * @param operations Array of MoveOperationV2 objects containing destination folders and keywords
   * @param filesByOperation Map of operation index to files to copy
   * @returns Results of the copy operations
   */
  async copyByOperations(
    operations: MoveOperationV2[],
    filesByOperation: Map<number, IndexedDocument[]>
  ): Promise<{
    operations: Array<{
      sourceQuery: string;
      destinationFolder: string;
      copied: string[];
      errors: string[];
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
      const errors: string[] = [];
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
          const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
          if (!sourceFile) {
            errors.push(filePath);
            continue;
          }

          // Ensure the destination folder exists
          await this.ensureFolderExists(operation.destinationFolder);

          // Copy the file
          await this.app.vault.copy(sourceFile, destinationPath);
          copied.push(filePath);
        } catch (error) {
          errors.push(filePath);
        }
      }

      operationResults.push({
        sourceQuery: operation.keywords ? operation.keywords.join(', ') : 'Search results',
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
  async applyUpdateInstruction(
    content: string,
    updateInstruction: UpdateInstruction
  ): Promise<string> {
    let lines = content.split('\n');

    switch (updateInstruction.type) {
      case 'replace': {
        const replaceInstruction = updateInstruction as ReplaceInstruction;
        content = content.replace(replaceInstruction.old, replaceInstruction.new);
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
        throw new Error(`Unsupported update type: ${(updateInstruction as any).type}`);
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
}
