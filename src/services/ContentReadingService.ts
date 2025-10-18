import { TFile, EditorRange } from 'obsidian';
import { isConversationLink } from '../utils/conversationUtils';
import type StewardPlugin from '../main';
import { ContentReadingArgs } from '../solutions/commands/handlers/ReadCommandHandler/zSchemas';
import { logger } from 'src/utils/logger';

/**
 * Result of a content reading operation
 */
export interface ContentReadingResult {
  blocks: ContentBlock[];
  source: 'cursor' | 'element' | 'entire' | 'unknown';
  elementType?: string;
  file?: {
    path: string;
    name: string;
  };
  range?: EditorRange;
}

/**
 * Represents detailed information about a section within a content block
 */
export interface SectionDetail {
  type: string;
  startLine: number;
  endLine: number;
}

/**
 * Represents a block of content in the editor
 * A block can have multiple sections if it contains mixed content (e.g., a paragraph with a list and code)
 */
export interface ContentBlock {
  startLine: number;
  endLine: number;
  sections: SectionDetail[];
  content: string;
}

/**
 * Service for reading content from the editor
 */
export class ContentReadingService {
  static instance: ContentReadingService;

  private get editor() {
    return this.plugin.editor;
  }

  private constructor(private plugin: StewardPlugin) {}

  static getInstance(plugin?: StewardPlugin) {
    if (plugin) {
      ContentReadingService.instance = new ContentReadingService(plugin);
      return ContentReadingService.instance;
    }
    if (!ContentReadingService.instance) {
      throw new Error('ContentReadingService is not initialized');
    }
    return ContentReadingService.instance;
  }

  /**
   * Read content from the editor based on extraction parameters
   * @param args Content reading parameters
   * @returns The read blocks, or null if unable to read
   */
  async readContent(args: {
    noteName: ContentReadingArgs['noteName'];
    readType: ContentReadingArgs['readType'];
    blocksToRead: ContentReadingArgs['blocksToRead'];
    elementType: ContentReadingArgs['elementType'];
    startLine: ContentReadingArgs['startLine'];
  }): Promise<ContentReadingResult> {
    // Get the file
    const file = args.noteName
      ? await this.plugin.mediaTools.findFileByNameOrPath(args.noteName)
      : this.plugin.app.workspace.getActiveFile();
    if (!file) {
      throw new Error(`No active file found for note: ${args.noteName}`);
    }

    switch (args.readType) {
      case 'above':
      default:
        return this.readBlocksAboveCursor(
          file,
          args.blocksToRead,
          args.elementType,
          args.startLine
        );

      case 'below':
        return this.readBlocksBelowCursor(
          file,
          args.blocksToRead,
          args.elementType,
          args.startLine
        );

      case 'entire':
        return this.readEntireContent(file);
    }
  }

  /**
   * Read blocks above the cursor using line-based detection
   * @param file The active file
   * @param blocksToRead Number of blocks to read
   * @param elementType Element type to look for (e.g., "table", "code", "paragraph")
   * @param startLine Optional line number to start reading from instead of cursor position
   * @returns Blocks above the cursor
   */
  private readBlocksAboveCursor(
    file: TFile,
    blocksToRead: number,
    elementType: ContentReadingArgs['elementType'] = null,
    startLine: ContentReadingArgs['startLine'] = null
  ): ContentReadingResult {
    const cursor = this.editor.getCursor();
    const blocks: ContentBlock[] = [];
    let currentLine = startLine !== null ? startLine : cursor.line;

    while (currentLine >= 0) {
      // If we have reached the maximum number of blocks, stop
      if (blocksToRead !== -1 && blocks.length >= blocksToRead) {
        break;
      }

      // Find the block that contains the current line
      const block = this.findBlockContainingLine(file, currentLine, 'above');

      if (block) {
        // Skip if we're looking for a specific element type and it doesn't match
        if (elementType && !this.matchesElementType(block.sections, elementType)) {
          // Move to the line before this block
          currentLine = block.startLine - 1;
          continue;
        }

        // Add the block to our results
        blocks.unshift(block);

        // Move to the line before this block
        currentLine = block.startLine - 1;
      } else {
        // If no block found, just move up one line
        currentLine--;
      }
    }

    return this.createContentReadingResult({ file, blocks, elementType });
  }

  /**
   * Read blocks below the cursor using line-based detection
   * @param file The active file
   * @param blocksToRead Number of blocks to read
   * @param elementType Element type to look for (e.g., "table", "code", "paragraph")
   * @param startLine Optional line number to start reading from instead of cursor position
   * @returns Blocks below the cursor
   */
  private readBlocksBelowCursor(
    file: TFile,
    blocksToRead: number,
    elementType: ContentReadingArgs['elementType'] = null,
    startLine: ContentReadingArgs['startLine'] = null
  ): ContentReadingResult {
    const cursor = this.editor.getCursor();
    const blocks: ContentBlock[] = [];
    const lineCount = this.editor.lineCount();
    let currentLine = startLine !== null ? startLine : cursor.line;

    // Process each line going downward until we reach the end
    while (currentLine < lineCount) {
      // If we have reached the maximum number of blocks, stop
      if (blocksToRead !== -1 && blocks.length >= blocksToRead) {
        break;
      }

      // Find the block that contains or starts at the current line
      const block = this.findBlockContainingLine(file, currentLine, 'below');

      if (block) {
        // Skip if we're looking for a specific element type and it doesn't match
        if (elementType && !this.matchesElementType(block.sections, elementType)) {
          // Move to the line after this block
          currentLine = block.endLine + 1;
          continue;
        }

        // Add the block to our results
        blocks.push(block);

        // Move to the line after this block
        currentLine = block.endLine + 1;
      } else {
        // If no block found, just move down one line
        currentLine++;
      }
    }

    return this.createContentReadingResult({ file, blocks, elementType });
  }

  /**
   * Create a ContentReadingResult object
   * @returns Formatted ContentReadingResult
   */
  private createContentReadingResult(params: {
    file: TFile;
    blocks: ContentBlock[];
    elementType: ContentReadingArgs['elementType'];
  }): ContentReadingResult {
    const { file, blocks, elementType } = params;
    const cursor = this.editor.getCursor();

    // If no blocks are found, return an empty result with clear indication
    if (blocks.length === 0) {
      return {
        blocks: [],
        source: 'unknown',
        file: {
          path: file.path,
          name: file.name,
        },
        elementType: elementType || undefined,
        range: {
          from: { line: cursor.line, ch: 0 },
          to: { line: cursor.line, ch: 0 },
        },
      };
    }

    // Get the range from the first to last block
    const startLine = blocks[0].startLine;
    const endLine = blocks[blocks.length - 1].endLine;

    return {
      blocks,
      source: elementType ? 'element' : 'cursor',
      file: {
        path: file.path,
        name: file.name,
      },
      elementType: elementType || undefined,
      range: {
        from: { line: startLine, ch: 0 },
        to: { line: endLine, ch: this.editor.getLine(endLine).length },
      },
    };
  }

  /**
   * Read the entire content of a file
   * @param file The file to read
   * @returns The entire file content as a single block with all sections detailed
   */
  private async readEntireContent(file: TFile): Promise<ContentReadingResult> {
    const content = await this.plugin.app.vault.cachedRead(file);
    const endLine = content.split('\n').length - 1;

    // Get all sections from the file cache
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const sections: SectionDetail[] = [];

    if (cache?.sections) {
      // Map all sections to SectionDetail format
      for (const section of cache.sections) {
        sections.push({
          type: section.type,
          startLine: section.position.start.line,
          endLine: section.position.end.line,
        });
      }
    }

    // If no sections found, create a default "entire" section
    if (sections.length === 0) {
      sections.push({
        type: 'entire',
        startLine: 0,
        endLine,
      });
    }

    // Create a single block containing the entire file with all sections
    const block: ContentBlock = {
      startLine: 0,
      endLine,
      sections,
      content,
    };

    return {
      blocks: [block],
      source: 'entire',
      file: {
        path: file.path,
        name: file.name,
      },
    };
  }

  /**
   * Find a content block that contains the specified line using the metadata cache
   * @param file The file to search in
   * @param lineNumber The line number to check
   * @param direction The direction to search ('above' or 'below')
   * @returns The content block, or null if none found
   */
  private findBlockContainingLine(
    file: TFile,
    lineNumber: number,
    direction: 'above' | 'below'
  ): ContentBlock | null {
    // Return early if the line is empty, command input, or embedded conversation note
    if (this.isIgnoredLine(lineNumber)) return null;

    const cache = this.plugin.app.metadataCache.getFileCache(file);

    if (!cache || !cache.sections) {
      throw new Error('No sections found in file');
    }

    let sectionIndex = cache.sections.findIndex(
      s => s.position.start.line <= lineNumber && s.position.end.line >= lineNumber
    );
    if (sectionIndex === -1) return null;

    let firstSection = cache.sections[sectionIndex];
    let lastSection = firstSection;
    const sections: SectionDetail[] = [
      {
        type: firstSection.type,
        startLine: firstSection.position.start.line,
        endLine: firstSection.position.end.line,
      },
    ];

    while (sectionIndex >= 0 && sectionIndex < cache.sections.length) {
      const currentSection = cache.sections[sectionIndex];
      const nextLineNumber =
        direction === 'above'
          ? currentSection.position.start.line - 1
          : currentSection.position.end.line + 1;

      if (this.isIgnoredLine(nextLineNumber)) {
        break;
      }

      sectionIndex += direction === 'above' ? -1 : 1;
      lastSection = cache.sections[sectionIndex];

      if (!lastSection) {
        break;
      }

      const sectionDetail: SectionDetail = {
        type: lastSection.type,
        startLine: lastSection.position.start.line,
        endLine: lastSection.position.end.line,
      };

      direction === 'below' ? sections.push(sectionDetail) : sections.unshift(sectionDetail);
    }

    // If we are reading above, swap the first and last section
    if (direction === 'above') {
      [firstSection, lastSection] = [lastSection, firstSection];
    }

    // Get the content
    const content = this.editor.getRange(
      { line: firstSection.position.start.line, ch: 0 },
      {
        line: lastSection.position.end.line,
        ch: this.editor.getLine(lastSection.position.end.line).length,
      }
    );

    return {
      startLine: firstSection.position.start.line,
      endLine: lastSection.position.end.line,
      sections,
      content,
    };
  }

  /**
   * Ignores if a line is empty, conversation link, or input line (command line)
   */
  private isIgnoredLine(lineNumber: number): boolean {
    try {
      const line = this.editor.getLine(lineNumber);
      const result =
        line.trim() === '' ||
        line.startsWith('/ ') ||
        isConversationLink(line, this.plugin.settings.stewardFolder);

      return result;
    } catch (error) {
      logger.error(`Error in isIgnoredLine for line ${lineNumber}:`, error);
      return true;
    }
  }

  /**
   * Check if a block's sections match the requested element type
   * @param sections The block sections with their type information
   * @param elementType The requested element type
   * @returns True if they match
   */
  private matchesElementType(sections: SectionDetail[], elementType: string): boolean {
    // Handle common synonyms and variations
    const normalizedElementType = elementType.toLowerCase().trim();

    // Check each section type for a match
    for (const section of sections) {
      const sectionType = section.type;

      if (
        sectionType === 'code' &&
        (normalizedElementType.includes('code') ||
          normalizedElementType.includes('script') ||
          normalizedElementType.includes('function'))
      ) {
        return true;
      }

      if (
        sectionType === 'table' &&
        (normalizedElementType.includes('table') ||
          normalizedElementType.includes('grid') ||
          normalizedElementType.includes('column'))
      ) {
        return true;
      }

      if (
        sectionType === 'list' &&
        (normalizedElementType.includes('list') ||
          normalizedElementType.includes('bullet') ||
          normalizedElementType.includes('item'))
      ) {
        return true;
      }

      if (
        sectionType === 'paragraph' &&
        (normalizedElementType.includes('paragraph') || normalizedElementType.includes('text'))
      ) {
        return true;
      }

      if (
        sectionType === 'heading' &&
        (normalizedElementType.includes('heading') ||
          normalizedElementType.includes('header') ||
          normalizedElementType.includes('title'))
      ) {
        return true;
      }

      if (
        sectionType === 'blockquote' &&
        (normalizedElementType.includes('quote') ||
          normalizedElementType.includes('blockquote') ||
          normalizedElementType.includes('callout'))
      ) {
        return true;
      }

      if (sectionType === 'image' && normalizedElementType.includes('image')) {
        return true;
      }

      if (sectionType === normalizedElementType) {
        return true;
      }
    }

    return false;
  }
}
