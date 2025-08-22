import { Editor, Notice } from 'obsidian';
import { isContinuationLine } from 'src/cm/extensions/CommandInputExtension';
import { UserDefinedCommandService } from './UserDefinedCommandService';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import type StewardPlugin from 'src/main';
import { StewardChatView } from 'src/views/StewardChatView';
import { logger } from 'src/utils/logger';

/**
 * Service for handling command input operations in the editor
 */
export class CommandInputService {
  private static instance: CommandInputService;
  private plugin: StewardPlugin;
  private editor: Editor | null = null;
  private userDefinedCommandService: UserDefinedCommandService;

  /**
   * Private constructor for singleton pattern
   * @param plugin - The plugin instance
   */
  private constructor(plugin: StewardPlugin) {
    this.plugin = plugin;
    this.userDefinedCommandService = UserDefinedCommandService.getInstance();
  }

  /**
   * Get the singleton instance of CommandInputService
   * @param plugin - The plugin instance (required on first call)
   */
  public static getInstance(plugin?: StewardPlugin): CommandInputService {
    if (plugin) {
      CommandInputService.instance = new CommandInputService(plugin);
      return CommandInputService.instance;
    }
    if (!CommandInputService.instance) {
      throw new Error('CommandInputService is not initialized');
    }
    return CommandInputService.instance;
  }

  /**
   * Create a new instance with the specified editor
   * @param editor - The editor to use
   * @returns A new CommandInputService instance with the specified editor
   */
  public withEditor(editor: Editor): CommandInputService {
    const service = new CommandInputService(this.plugin);
    service.editor = editor;
    return service;
  }

  /**
   * Gets the current editor
   * @returns The current editor, either the one set with withEditor or the plugin's editor
   */
  private getEditor(): Editor {
    if (this.editor) {
      return this.editor;
    }

    // Fallback to the plugin's editor
    return this.plugin.editor;
  }

  /**
   * Find the first command input line in the editor
   * @returns The command line number and prefix, or null if not found
   */
  private findCommandInputLine(): { lineNumber: number; prefix: string } | null {
    const editor = this.getEditor();
    const extendedPrefixes = this.userDefinedCommandService.buildExtendedPrefixes();
    const lineCount = editor.lineCount();

    for (let i = 0; i < lineCount; i++) {
      const lineText = editor.getLine(i);
      const matchedPrefix = extendedPrefixes.find(prefix => lineText.startsWith(prefix));

      if (matchedPrefix) {
        return {
          lineNumber: i,
          prefix: matchedPrefix,
        };
      }
    }

    return null;
  }

  /**
   * Find the last line of an input
   * @param lineNumber - The line number of the command line
   * @returns The last line number of the command block
   */
  private findLastInputLine(lineNumber: number): number {
    const editor = this.getEditor();
    const lineCount = editor.lineCount();
    let lastLineNumber = lineNumber;

    for (let i = lineNumber + 1; i < lineCount; i++) {
      const lineText = editor.getLine(i);
      if (isContinuationLine(lineText)) {
        lastLineNumber = i;
      } else {
        break;
      }
    }

    return lastLineNumber;
  }

  /**
   * Create a selection marker for the given selection
   */
  private createSelectionMarker(filePath: string): string {
    const cursorFrom = this.getEditor().getCursor('from');
    const cursorTo = this.getEditor().getCursor('to');
    const selection = this.getEditor().getSelection();

    return `{{stw-selected from:${cursorFrom.line + 1},to:${cursorTo.line + 1},selection:${new MarkdownUtil(selection).escape(true).getText()},path:${filePath}}}`;
  }

  /**
   * Add selection to the end of an input
   * @param lineNumber - The line number of the command line
   * @param selectionMarker - The selection marker to add
   * @returns The position where the cursor should be placed after insertion
   */
  private addSelectionToInput(
    lineNumber: number,
    selectionMarker: string
  ): { line: number; ch: number } {
    const editor = this.getEditor();
    // Find the last line of the command block
    const lastLineNumber = this.findLastInputLine(lineNumber);
    const lastLineText = editor.getLine(lastLineNumber);

    // Insert the selection marker at the end of the last line
    const insertText = `${selectionMarker} `;
    editor.replaceRange(
      insertText,
      { line: lastLineNumber, ch: lastLineText.length },
      { line: lastLineNumber, ch: lastLineText.length }
    );

    // Return the position for the cursor
    return {
      line: lastLineNumber,
      ch: lastLineText.length + insertText.length,
    };
  }

  /**
   * Create an input with the given selection
   * @param insertLine - The line number where to insert the command
   * @param selectionMarker - The selection marker to add
   * @returns The position where the cursor should be placed after insertion
   */
  private createInputWithSelection(
    insertLine: number,
    selectionMarker: string
  ): { line: number; ch: number } {
    const editor = this.getEditor();
    const insertText = `/ ${selectionMarker} `;
    editor.replaceRange(`${insertText}\n`, { line: insertLine, ch: 0 });

    return {
      line: insertLine,
      ch: insertText.length,
    };
  }

  /**
   * Find the appropriate insertion line for a new command
   * @param cursorLine - The current cursor line
   * @returns The line number where the command should be inserted
   */
  private findInputInsertionLine(cursorLine: number): number {
    const editor = this.getEditor();
    const lineCount = editor.lineCount();
    let insertLine = cursorLine;

    // Look for the next newline after the cursor
    for (let i = cursorLine; i < lineCount; i++) {
      const currentLine = editor.getLine(i);

      if (currentLine === '') {
        insertLine = i + 1;
        break;
      }
    }

    // If no empty line found, insert at the end
    if (insertLine === cursorLine) {
      insertLine = lineCount;
    }

    return insertLine;
  }

  /**
   * Handle adding selected text to conversation
   * @param target - Whether to add to inline conversation or chat view
   */
  public async addSelectionToConversation(target: 'inline' | 'chat' = 'inline'): Promise<void> {
    try {
      // Get the current file path
      const activeFile = this.plugin.app.workspace.getActiveFile();
      const filePath = activeFile ? activeFile.path : '';

      let activeEditor = this.getEditor();

      if (target === 'chat') {
        await this.plugin.openChat();
        const chatLeaf = this.plugin.getChatLeaf();
        const chatView = chatLeaf.view;

        if (chatView instanceof StewardChatView) {
          const chatEditor = chatView.editor;
          activeEditor = chatEditor;
        } else {
          logger.error('Chat view is not a StewardChatView');
          return;
        }
      }

      // Create a service instance with the active editor
      const withActiveEditor = this.withEditor(activeEditor);

      // Create the selection marker
      const selectionMarker = this.createSelectionMarker(filePath);

      // Find the command line
      const commandLineInfo = withActiveEditor.findCommandInputLine();

      if (!commandLineInfo) {
        // No command line found, create a new one below the selected block
        const cursorTo = this.getEditor().getCursor('to');
        const insertLine = withActiveEditor.findInputInsertionLine(cursorTo.line);

        // Create a new command line with the selection
        const cursorPos = withActiveEditor.createInputWithSelection(insertLine, selectionMarker);

        // Set cursor after the selection
        activeEditor.setCursor(cursorPos);
      } else {
        // Add selection to the end of the command line
        const cursorPos = withActiveEditor.addSelectionToInput(
          commandLineInfo.lineNumber,
          selectionMarker
        );

        // Set cursor after the selection
        activeEditor.setCursor(cursorPos);
      }
    } catch (error) {
      logger.error('Error adding selection to conversation:', error);
      new Notice('Error adding selection to conversation');
    }
  }
}
