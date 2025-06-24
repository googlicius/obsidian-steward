import { TFile, EditorRange, EditorPosition } from 'obsidian';
import { logger } from '../utils/logger';
import StewardPlugin from '../main';
import { isConversationLink } from '../utils/conversationUtils';
import { IMAGE_LINK_PATTERN } from 'src/constants';

/**
 * Result of a content reading operation
 */
export interface ContentReadingResult {
  blocks: ContentBlock[];
  source: 'selected' | 'cursor' | 'element' | 'entire' | 'unknown';
  elementType?: string;
  file?: TFile;
  range?: EditorRange;
}

/**
 * Represents a block of content in the editor
 * A block can have multiple types if it contains mixed content (e.g., a paragraph with a list and code)
 */
export interface ContentBlock {
  startLine: number;
  endLine: number;
  types: string[]; // Array of types present in this block
  content: string;
}

/**
 * Parameters for identifying blocks
 */
interface IdentifyBlocksParams {
  cursor?: EditorPosition;
  maxBlocks: number;
  direction: 'above' | 'below';
  elementType?: string | null;
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
    if (!ContentReadingService.instance) {
      if (!plugin) {
        throw new Error('Plugin is not initialized');
      }
      ContentReadingService.instance = new ContentReadingService(plugin);
    }
    return ContentReadingService.instance;
  }

  /**
   * Read content from the editor based on extraction parameters
   * @param args Content reading parameters
   * @returns The read blocks, or null if unable to read
   */
  async readContent(args: {
    readType: 'above' | 'below' | 'selected' | 'entire';
    blocksToRead: number;
    elementType: string | null;
    foundPlaceholder: string;
    confidence: number;
    explanation: string;
    lang?: string | undefined;
  }): Promise<ContentReadingResult | null> {
    // Get the active file
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file) {
      logger.error('No active file found');
      return null;
    }

    try {
      switch (args.readType) {
        case 'selected':
          return this.readSelectedContent(file);

        case 'entire':
          return this.readEntireContent(file);

        case 'below':
          return this.readBlocksBelowCursor(file, args.blocksToRead, args.elementType);

        case 'above':
        default:
          return this.readBlocksAboveCursor(file, args.blocksToRead, args.elementType);
      }
    } catch (error) {
      logger.error('Error reading content:', error);
      return null;
    }
  }

  /**
   * Read selected content from the editor
   * @param file The active file
   * @returns Selected content as a block
   */
  private readSelectedContent(file: TFile): ContentReadingResult {
    const selection = this.editor.getSelection();
    if (!selection) {
      // If no selection, fall back to content above cursor
      return this.readBlocksAboveCursor(file, 1);
    }

    // Get the selection range
    const from = this.editor.offsetToPos(this.editor.posToOffset(this.editor.getCursor('from')));
    const to = this.editor.offsetToPos(this.editor.posToOffset(this.editor.getCursor('to')));

    // Create a single block from the selection
    const block: ContentBlock = {
      startLine: from.line,
      endLine: to.line,
      types: ['selected'],
      content: selection,
    };

    return {
      blocks: [block],
      source: 'selected',
      file,
      range: { from, to },
    };
  }

  /**
   * Read blocks above the cursor using line-based detection
   * @param file The active file
   * @param blocksToRead Number of blocks to read
   * @param elementType Element type to look for. Supports AND/OR conditions:
   *  - For OR conditions, use comma-separated values (e.g., "table, code")
   *  - For AND conditions, use "+" between types (e.g., "paragraph+list")
   * @returns Blocks above the cursor
   */
  private readBlocksAboveCursor(
    file: TFile,
    blocksToRead: number,
    elementType: string | null = null
  ): ContentReadingResult {
    const cursor = this.editor.getCursor();
    const blocks = this.identifyBlocksUsingLines({
      maxBlocks: blocksToRead,
      direction: 'above',
      elementType,
    });

    // If no blocks are found, return an empty result with clear indication
    if (blocks.length === 0) {
      return {
        blocks: [],
        source: 'unknown',
        file,
        elementType: elementType || undefined,
        range: {
          from: { line: cursor.line, ch: 0 },
          to: { line: cursor.line, ch: 0 },
        },
      };
    }

    // Get the earliest block's start line and the last block's end line for the range
    const startLine = blocks[0].startLine;
    const endLine = blocks[blocks.length - 1].endLine;

    return {
      blocks,
      source: elementType ? 'element' : 'cursor',
      file,
      elementType: elementType || undefined,
      range: {
        from: { line: startLine, ch: 0 },
        to: { line: endLine, ch: this.editor.getLine(endLine).length },
      },
    };
  }

  /**
   * Read blocks below the cursor using line-based detection
   * @param file The active file
   * @param blocksToRead Number of blocks to read
   * @param elementType Element type to look for. Supports AND/OR conditions:
   *  - For OR conditions, use comma-separated values (e.g., "table, code")
   *  - For AND conditions, use "+" between types (e.g., "paragraph+list")
   * @returns Blocks below the cursor
   */
  private readBlocksBelowCursor(
    file: TFile,
    blocksToRead: number,
    elementType: string | null = null
  ): ContentReadingResult {
    const cursor = this.editor.getCursor();
    const blocks = this.identifyBlocksUsingLines({
      maxBlocks: blocksToRead,
      direction: 'below',
      elementType,
    });

    // If no blocks are found, return an empty result with clear indication
    if (blocks.length === 0) {
      return {
        blocks: [],
        source: 'unknown',
        file,
        elementType: elementType || undefined,
        range: {
          from: { line: cursor.line, ch: 0 },
          to: { line: cursor.line, ch: 0 },
        },
      };
    }

    // Get the cursor line and the last block's end line for the range
    const startLine = cursor.line;
    const endLine = blocks[blocks.length - 1].endLine;

    return {
      blocks,
      source: elementType ? 'element' : 'cursor',
      file,
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
   * @returns The entire file content as a single block
   */
  private async readEntireContent(file: TFile): Promise<ContentReadingResult> {
    const content = await this.plugin.app.vault.read(file);

    // Create a single block containing the entire file
    const block: ContentBlock = {
      startLine: 0,
      endLine: content.split('\n').length - 1,
      types: ['entire'],
      content,
    };

    return {
      blocks: [block],
      source: 'entire',
      file,
    };
  }

  /**
   * Identify blocks using line-based detection
   * @param params Object containing search parameters
   * @returns Array of identified blocks
   */
  private identifyBlocksUsingLines({
    cursor = this.editor.getCursor(),
    maxBlocks,
    direction,
    elementType = null,
  }: IdentifyBlocksParams): ContentBlock[] {
    try {
      const blocks: ContentBlock[] = [];
      const lineCount = this.editor.lineCount();

      // Start from the cursor line
      let currentLine = cursor.line;

      // For 'above' direction, we need to scan backward
      if (direction === 'above') {
        // Process each line going upward until we reach the start
        while (currentLine >= 0) {
          // If we have reached the maximum number of blocks, stop
          if (maxBlocks !== -1 && blocks.length >= maxBlocks) {
            break;
          }

          // Find the block that contains the current line
          const block = this.findBlockContainingLine(currentLine, 'above');

          if (block) {
            // Skip if we're looking for a specific element type and it doesn't match
            if (elementType && !this.matchesElementType(block.types, elementType)) {
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
      } else {
        // For 'below' direction, we scan forward
        while (currentLine < lineCount) {
          // If we have reached the maximum number of blocks, stop
          if (maxBlocks !== -1 && blocks.length >= maxBlocks) {
            break;
          }

          // Find the block that contains or starts at the current line
          const block = this.findBlockContainingLine(currentLine, 'below');

          if (block) {
            // Skip if we're looking for a specific element type and it doesn't match
            if (elementType && !this.matchesElementType(block.types, elementType)) {
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
      }

      // Checking AND condition
      if (
        elementType &&
        this.isANDCondition(elementType) &&
        !this.blocksMatchANDCondition(blocks, elementType)
      ) {
        return [];
      }

      return blocks;
    } catch (error) {
      logger.error('Error identifying blocks using lines:', error);
      return [];
    }
  }

  /**
   * Find a content block that contains the specified line
   * @param lineNumber The line number to check
   * @param direction Search direction ('above' or 'below')
   * @returns The content block, or null if none found
   */
  private findBlockContainingLine(
    lineNumber: number,
    direction: 'above' | 'below'
  ): ContentBlock | null {
    try {
      // Get the total number of lines in the editor
      const lineCount = this.editor.lineCount();

      // Check if the line number is valid
      if (lineNumber < 0 || lineNumber >= lineCount) {
        return null;
      }

      // Start from the given line and find a suitable non-empty line
      let currentLine = lineNumber;

      // If the current line is non-empty, try to identify its block
      if (!this.isIgnoredLine(currentLine)) {
        const block = this.identifyBlockFromLine(currentLine);
        if (block) {
          return block;
        }
      }

      // Otherwise, search in the requested direction
      // Continue until we reach the file boundaries
      let canContinue = true;
      while (canContinue) {
        // Move in the specified direction
        if (direction === 'above') {
          currentLine--;
          if (currentLine < 0) {
            canContinue = false; // Reached the top of the file
            continue;
          }
        } else {
          currentLine++;
          if (currentLine >= lineCount) {
            canContinue = false; // Reached the bottom of the file
            continue;
          }
        }

        // Check if the current line is non-empty
        if (!this.isIgnoredLine(currentLine)) {
          const block = this.identifyBlockFromLine(currentLine);
          if (block) {
            return block;
          }
        }
      }

      // No suitable line found
      return null;
    } catch (error) {
      logger.error('Error finding block containing line:', error);
      return null;
    }
  }

  /**
   * Identify a content block from a specific line
   * @param lineNumber The line number to start from
   * @returns The identified content block, or null if none found
   */
  private identifyBlockFromLine(lineNumber: number): ContentBlock | null {
    try {
      const line = this.editor.getLine(lineNumber).trim();

      // Skip empty lines
      if (this.isIgnoredLine(lineNumber)) {
        return null;
      }

      // Get initial block type
      const initialBlockType = this.detectBlockType(line);

      // Find the start of the block (search upward)
      const {
        lineNumber: startLineNum,
        types: startTypes,
        inList,
        inCodeBlock,
      } = this.findBlockBoundary({
        startingLine: lineNumber,
        direction: 'above',
        initialBlockType,
        inList: initialBlockType === 'list',
        inCodeBlock: initialBlockType === 'code',
      });

      // Find the end of the block (search downward)
      const { lineNumber: endLineNum, types: endTypes } = this.findBlockBoundary({
        startingLine: lineNumber,
        direction: 'below',
        initialBlockType,
        inList,
        inCodeBlock,
      });

      // Combine all collected types
      const allTypes = new Set([...startTypes, ...endTypes]);

      // Get the content of the block
      const content = this.editor.getRange(
        { line: startLineNum, ch: 0 },
        { line: endLineNum, ch: this.editor.getLine(endLineNum).length }
      );

      return {
        startLine: startLineNum,
        endLine: endLineNum,
        types: Array.from(allTypes),
        content,
      };
    } catch (error) {
      logger.error('Error identifying block from line:', error);
      return null;
    }
  }

  /**
   * Detect the type of a block based on its first line
   * @param line The line to analyze
   * @returns The detected block type as a string (one of: 'paragraph', 'code', 'list', 'table', 'blockquote', 'heading', 'other')
   */
  private detectBlockType(line: string): string {
    line = line.trim();

    // Check for headings
    if (line.startsWith('#')) {
      return 'heading';
    }

    // Check for blockquotes
    if (line.startsWith('>')) {
      return 'blockquote';
    }

    // Check for code blocks start/end
    if (line.startsWith('```')) {
      return 'code';
    }

    // Check for tables
    if (line.includes('|') && line.trim().startsWith('|')) {
      return 'table';
    }

    // Check for lists
    if (this.isListItem(line)) {
      return 'list';
    }

    // Check for embedded images
    if (line.startsWith('![[') && new RegExp(IMAGE_LINK_PATTERN, 'gi').test(line)) {
      return 'image';
    }

    // Default to paragraph
    return 'paragraph';
  }

  /**
   * Detect the type of the next block in a specified direction
   * @param lineNumber The current line number
   * @param direction The direction to look ('above' or 'below')
   * @returns The detected block type or null if no valid block found
   */
  private detectNextBlockType(lineNumber: number, direction: 'above' | 'below'): string | null {
    try {
      const lineCount = this.editor.lineCount();

      // Determine which line to check based on direction
      const nextLineNumber = direction === 'above' ? lineNumber - 1 : lineNumber + 1;

      // Check if we're at the boundaries of the document
      if (nextLineNumber < 0 || nextLineNumber >= lineCount) {
        return null;
      }

      // Get the next line and check if it's ignored
      const nextLine = this.editor.getLine(nextLineNumber).trim();
      if (this.isIgnoredLine(nextLineNumber)) {
        // Recursively check the next line in the same direction
        return this.detectNextBlockType(nextLineNumber, direction);
      }

      // Detect and return the block type
      return this.detectBlockType(nextLine);
    } catch (error) {
      logger.error('Error detecting next block type:', error);
      return null;
    }
  }

  /**
   * Ignores if a line is empty, conversation link, or general command
   */
  private isIgnoredLine(lineNumber: number): boolean {
    const line = this.editor.getLine(lineNumber);
    return (
      line.trim() === '' ||
      line === '/ ' ||
      isConversationLink(line, this.plugin.settings.stewardFolder)
    );
  }

  /**
   * Find a block boundary in a specified direction
   */
  private findBlockBoundary(params: {
    startingLine: number;
    direction: 'above' | 'below';
    initialBlockType: string;
    inList: boolean;
    inCodeBlock: boolean;
  }): { lineNumber: number; types: Set<string>; inList: boolean; inCodeBlock: boolean } {
    const { startingLine, direction, initialBlockType } = params;
    let { inList, inCodeBlock } = params;
    const lineCount = this.editor.lineCount();
    const types = new Set<string>([initialBlockType]);
    let currentLineNumber = startingLine;

    // Determine boundary conditions and line increment based on direction
    const atBoundary = () =>
      direction === 'above' ? currentLineNumber <= 0 : currentLineNumber >= lineCount - 1;

    const increment = direction === 'above' ? -1 : 1;

    // Keep track of whether we can continue searching
    // let canContinue = true;

    while (!atBoundary()) {
      const nextLineNumber = currentLineNumber + increment;
      const nextLine = this.editor.getLine(nextLineNumber).trim();
      const currentLine = this.editor.getLine(currentLineNumber).trim();
      const nextLineType = this.detectBlockType(nextLine);
      const currentLineType = this.detectBlockType(currentLine);

      // Handle code block boundaries
      if (inCodeBlock && nextLineType === 'code') {
        inCodeBlock = false;
      }

      // Handle list boundaries
      if (inList && this.isIgnoredLine(nextLineNumber)) {
        if (currentLineType !== 'list') {
          inList = false;
        } else {
          const adjacentBlockType = this.detectNextBlockType(currentLineNumber, direction);
          if (adjacentBlockType !== 'list') {
            inList = false;
          }
        }
      }

      // Collect type if line isn't empty
      if (!this.isIgnoredLine(nextLineNumber)) {
        types.add(nextLineType);
      }

      // Check if the next line is empty
      if (this.isIgnoredLine(nextLineNumber)) {
        if (!inCodeBlock && !inList) {
          // canContinue = false;
          // continue;
          break;
        }
      }

      // Move to the next line
      currentLineNumber = nextLineNumber;
    }

    return { lineNumber: currentLineNumber, types, inList, inCodeBlock };
  }

  /**
   * Check if a line is a list item
   * @param line The line to check
   * @returns True if the line is a list item
   */
  private isListItem(line: string): boolean {
    line = line.trim();
    // Check for unordered list items
    if (/^[-*+]\s/.test(line)) {
      return true;
    }

    // Check for ordered list items
    if (/^\d+\.\s/.test(line)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a block's types match the requested element type
   * @param blockTypes The block types
   * @param elementType The requested element type with possible AND/OR conditions
   * @returns True if they match
   */
  private matchesElementType(blockTypes: string[], elementType: string): boolean {
    // Handle common synonyms and variations
    const normalizedElementType = elementType.toLowerCase().trim();

    // Check for OR conditions (comma-separated values)
    if (this.isORCondition(normalizedElementType)) {
      const types = normalizedElementType.split(',').map(type => type.trim());
      return types.some(type => this.matchesElementType(blockTypes, type));
    }

    // Single element type check (this is a base case for the recursion)
    for (const blockType of blockTypes) {
      if (
        blockType === 'code' &&
        (normalizedElementType.includes('code') ||
          normalizedElementType.includes('script') ||
          normalizedElementType.includes('function'))
      ) {
        return true;
      }

      if (
        blockType === 'table' &&
        (normalizedElementType.includes('table') ||
          normalizedElementType.includes('grid') ||
          normalizedElementType.includes('column'))
      ) {
        return true;
      }

      if (
        blockType === 'list' &&
        (normalizedElementType.includes('list') ||
          normalizedElementType.includes('bullet') ||
          normalizedElementType.includes('item'))
      ) {
        return true;
      }

      if (
        blockType === 'paragraph' &&
        (normalizedElementType.includes('paragraph') || normalizedElementType.includes('text'))
      ) {
        return true;
      }

      if (
        blockType === 'heading' &&
        (normalizedElementType.includes('heading') ||
          normalizedElementType.includes('header') ||
          normalizedElementType.includes('title'))
      ) {
        return true;
      }

      if (
        blockType === 'blockquote' &&
        (normalizedElementType.includes('quote') ||
          normalizedElementType.includes('blockquote') ||
          normalizedElementType.includes('callout'))
      ) {
        return true;
      }

      if (blockType === 'image' && normalizedElementType.includes('image')) {
        return true;
      }

      if (blockType === normalizedElementType) {
        return true;
      }
    }

    return false;
  }

  private isANDCondition(elementType: string): boolean {
    return elementType.includes('+');
  }

  private isORCondition(elementType: string): boolean {
    return elementType.includes(',');
  }

  private blocksMatchANDCondition(blocks: ContentBlock[], elementType: string): boolean {
    const types = elementType.split('+');

    for (const type of types) {
      const atLeastOneBlockMatches = blocks.some(block =>
        this.matchesElementType(block.types, type)
      );

      if (!atLeastOneBlockMatches) {
        return false;
      }
    }

    return true;
  }
}
