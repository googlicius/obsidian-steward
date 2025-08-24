import { Editor, Notice } from 'obsidian';
import { Line, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
  private editor: Editor | null = null;

  private constructor(private plugin: StewardPlugin) {}

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
    const extendedPrefixes = this.plugin.userDefinedCommandService.buildExtendedPrefixes();
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
      if (this.isContinuationLine(lineText)) {
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

  public isCommandLine(line: Line): boolean {
    const extendedPrefixes = UserDefinedCommandService.getInstance().buildExtendedPrefixes();
    return extendedPrefixes.some(prefix => line.text.startsWith(prefix));
  }

  public isContinuationLine(text: string): boolean {
    return text.startsWith('  ') && !text.startsWith('   ');
  }

  public isGeneralCommandLine(line: Line): boolean {
    return line.text.startsWith('/ ') && line.text.length > 2;
  }

  public getInputPrefix(line: Line, doc: Text): string | undefined {
    let prefix;

    if (this.isContinuationLine(line.text)) {
      // Find the command line above
      let currentLineNum = line.number;
      let commandLine: Line | null = null;

      // Search upwards for the command line
      while (currentLineNum > 1) {
        currentLineNum--;
        const prevLine = doc.line(currentLineNum);

        // If we find a non-continuation line that's not a command, break
        if (!prevLine.text.startsWith('  ') && !prevLine.text.startsWith('/')) {
          break;
        }

        // If we find a command line, use it
        if (prevLine.text.startsWith('/')) {
          commandLine = prevLine;
          break;
        }
      }

      prefix = commandLine?.text.split(' ')[0];
    }

    if (this.isCommandLine(line)) {
      prefix = line.text.split(' ')[0];
    }

    if (prefix) {
      return prefix === '/' ? 'general' : prefix.replace('/', '');
    }

    return undefined;
  }

  /**
   * Gets all lines that belong to a command block (command line + continuation lines)
   */
  public getCommandBlock(view: EditorView, line: Line): Line[] {
    const { doc } = view.state;
    const lines: Line[] = [line];

    // If this is not a command line, return empty array
    if (!this.isCommandLine(line)) {
      return [];
    }

    // Check for continuation lines below
    let nextLineNum = line.number + 1;
    while (nextLineNum <= doc.lines) {
      const nextLine = doc.line(nextLineNum);
      if (this.isContinuationLine(nextLine.text)) {
        lines.push(nextLine);
        nextLineNum++;
      } else {
        break;
      }
    }

    return lines;
  }

  /**
   * Gets the combined content of a command block
   */
  public getCommandBlockContent(commandBlock: Line[]): string {
    if (commandBlock.length === 0) return '';

    // Get content from all lines, preserving the command prefix in the first line
    let content = commandBlock[0].text;

    // Add content from continuation lines (removing the 2-space prefix)
    for (let i = 1; i < commandBlock.length; i++) {
      content += '\n' + commandBlock[i].text.substring(2);
    }

    return content.trim();
  }
}
