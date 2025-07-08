import { Editor, Notice, Plugin, TFile, WorkspaceLeaf, addIcon } from 'obsidian';
import i18next from './i18n';
import StewardSettingTab from './settings';
import { EditorView } from '@codemirror/view';
import { createCommandInputExtension } from './cm/extensions/CommandInputExtension';
import { createCalloutSearchResultPostProcessor } from './cm/post-processors/CalloutSearchResultPostProcessor';
import { ConversationEventHandler } from './services/ConversationEventHandler';
import { eventEmitter } from './services/EventEmitter';
import { ObsidianAPITools } from './tools/obsidianAPITools';
import { SearchService } from './solutions/search';
import { DateTime } from 'luxon';
import { encrypt, decrypt, generateSaltKeyId } from './utils/cryptoUtils';
import { logger } from './utils/logger';
import { ConversationRenderer } from './services/ConversationRenderer';
import { ConversationArtifactManager } from './services/ConversationArtifactManager';
import { GitEventHandler } from './solutions/git/GitEventHandler';
import { ContentReadingService } from './services/ContentReadingService';
import { StewardPluginSettings } from './types/interfaces';
import { Line, Text } from '@codemirror/state';
import {
  COMMAND_PREFIXES,
  DEFAULT_SETTINGS,
  SMILE_CHAT_ICON_ID,
  STW_CONVERSATION_VIEW_CONFIG,
} from './constants';
import { StewardConversationView } from './views/StewardConversationView';
import { ConversationNoteCreatedPayload, Events } from './types/events';
import { createStewardConversationProcessor } from './cm/post-processors/StewardConversationProcessor';
import { ObsidianEditor } from './types/types';
import { isConversationLink, extractConversationTitle } from './utils/conversationUtils';
import { CommandProcessorService } from './services/CommandProcessorService';
import { UserDefinedCommandService } from './services/UserDefinedCommandService';
import { classify } from 'modelfusion';
import { retry } from './utils/retry';
import { getClassifier } from './lib/modelfusion/classifiers/getClassifier';
import { MediaTools } from './tools/mediaTools';
import { NoteContentService } from './services/NoteContentService';
import { LLMService } from './services/LLMService';

// Generate a random string for DB prefix
function generateRandomDbPrefix(): string {
  return `obsidian_steward_${Math.random().toString(36).substring(2, 10)}`;
}

export default class StewardPlugin extends Plugin {
  settings: StewardPluginSettings;
  obsidianAPITools: ObsidianAPITools;
  searchService: SearchService;
  staticConversationTitle = 'Steward Chat';
  artifactManager: ConversationArtifactManager;
  conversationRenderer: ConversationRenderer;
  gitEventHandler: GitEventHandler;
  contentReadingService: ContentReadingService;
  commandProcessorService: CommandProcessorService;
  userDefinedCommandService: UserDefinedCommandService;
  conversationEventHandler: ConversationEventHandler;
  mediaTools: MediaTools;
  noteContentService: NoteContentService;
  llmService: LLMService;

  get editor(): ObsidianEditor {
    return this.app.workspace.activeEditor?.editor as ObsidianEditor;
  }

  async onload() {
    await this.loadSettings();

    // Exclude steward folders from search
    this.excludeFoldersFromSearch([
      `${this.settings.stewardFolder}/Conversations`,
      `${this.settings.stewardFolder}/Commands`,
      'Excalidraw',
      'copilot*',
    ]);

    // Set the placeholder text based on the current language
    document.documentElement.style.setProperty(
      '--steward-placeholder-text',
      `'${i18next.t('ui.commandPlaceholder')}'`
    );

    // Generate DB prefix if not already set
    if (!this.settings.searchDbPrefix) {
      this.settings.searchDbPrefix = generateRandomDbPrefix();
      await this.saveSettings();
    }

    // Setup encryption salt if not already set
    if (!this.settings.saltKeyId) {
      this.settings.saltKeyId = generateSaltKeyId();
      await this.saveSettings();
    }

    // Set encryption version if not already set
    if (!this.settings.encryptionVersion) {
      this.settings.encryptionVersion = 1;
      await this.saveSettings();
    }

    // Initialize the search service with the stored DB prefix and exclude folders
    this.searchService = SearchService.getInstance({
      app: this.app,
      dbName: this.settings.searchDbPrefix,
      excludeFolders: [
        ...this.settings.excludedFolders,
        `${this.settings.stewardFolder}/Conversations`,
      ],
    });

    // Initialize the search service
    await this.searchService.initialize();

    // Initialize the ObsidianAPITools with the SearchTool
    this.obsidianAPITools = new ObsidianAPITools(this.app);

    // Initialize the media tools
    this.mediaTools = MediaTools.getInstance(this.app);

    // Initialize the note content service
    this.noteContentService = NoteContentService.getInstance(this.app);

    // Initialize the LLM service
    this.llmService = LLMService.getInstance(this);

    // Build the index if it's not already built
    this.checkAndBuildIndexIfNeeded();

    const decryptedOpenAIKey = this.getDecryptedApiKey('openai');
    if (decryptedOpenAIKey) {
      process.env.OPENAI_API_KEY = decryptedOpenAIKey;
    }

    const decryptedElevenLabsKey = this.getDecryptedApiKey('elevenlabs');
    if (decryptedElevenLabsKey) {
      process.env.ELEVENLABS_API_KEY = decryptedElevenLabsKey;
    }

    const decryptedDeepSeekKey = this.getDecryptedApiKey('deepseek');
    if (decryptedDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = decryptedDeepSeekKey;
    }

    // Register custom icon
    addIcon(
      SMILE_CHAT_ICON_ID,
      `<svg fill="currentColor" viewBox="0 0 32 32" id="icon" xmlns="http://www.w3.org/2000/svg">
			<path d="M16,19a6.9908,6.9908,0,0,1-5.833-3.1287l1.666-1.1074a5.0007,5.0007,0,0,0,8.334,0l1.666,1.1074A6.9908,6.9908,0,0,1,16,19Z"/>
			<path d="M20,8a2,2,0,1,0,2,2A1.9806,1.9806,0,0,0,20,8Z"/>
			<path d="M12,8a2,2,0,1,0,2,2A1.9806,1.9806,0,0,0,12,8Z"/>
			<path d="M17.7358,30,16,29l4-7h6a1.9966,1.9966,0,0,0,2-2V6a1.9966,1.9966,0,0,0-2-2H6A1.9966,1.9966,0,0,0,4,6V20a1.9966,1.9966,0,0,0,2,2h9v2H6a3.9993,3.9993,0,0,1-4-4V6A3.9988,3.9988,0,0,1,6,2H26a3.9988,3.9988,0,0,1,4,4V20a3.9993,3.9993,0,0,1-4,4H21.1646Z"/>
		</svg>`
    );

    // Add ribbon icon with custom icon
    this.addRibbonIcon(SMILE_CHAT_ICON_ID, i18next.t('ui.openStewardChat'), async () => {
      await this.openStaticConversation();
    });

    this.registerStuffs();

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new StewardSettingTab(this.app, this));

    // Initialize the content reading service
    this.contentReadingService = ContentReadingService.getInstance(this);

    // Initialize the UserDefinedCommandService
    this.userDefinedCommandService = UserDefinedCommandService.getInstance(this);

    // Initialize the ConversationRenderer
    this.conversationRenderer = new ConversationRenderer(this);

    // Initialize the ConversationArtifactManager
    this.artifactManager = ConversationArtifactManager.getInstance();

    // Initialize the conversation event handler
    this.conversationEventHandler = new ConversationEventHandler({ plugin: this });

    // Initialize Git event handler for tracking and reverting changes
    this.gitEventHandler = new GitEventHandler(this.app, this);

    // Initialize the CommandProcessorService
    this.commandProcessorService = new CommandProcessorService(this);

    this.initializeClassifier();
  }

  onunload() {
    // Unload the search service
    this.searchService.unload();

    // Unload the conversation event handler
    this.conversationEventHandler.unload();
  }

  private registerStuffs() {
    // Add command for toggling Steward chat with hotkey
    this.addCommand({
      id: 'toggle-steward-chat',
      name: 'Toggle Steward Chat',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'l' }],
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile && activeFile.name.startsWith(this.staticConversationTitle)) {
          this.toggleStaticConversation();
        } else {
          this.openStaticConversation();
        }
      },
    });

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    const statusBarItemEl = this.addStatusBarItem();

    // Command to build search index
    this.addCommand({
      id: 'build-search-index',
      name: 'Build Search Index',
      callback: async () => {
        new Notice('Building index...');
        try {
          statusBarItemEl.setText(i18next.t('ui.buildingIndexes'));
          await this.searchService.indexer.indexAllFiles();
          statusBarItemEl.setText('');
          new Notice('Building Search Index completed!');
        } catch (error) {
          logger.error('Error building search index:', error);
          new Notice(i18next.t('ui.errorBuildingSearchIndex'));
        }
      },
    });

    // Command to toggle debug mode
    this.addCommand({
      id: 'toggle-debug-mode',
      name: 'Toggle Debug Mode',
      callback: async () => {
        this.settings.debug = !this.settings.debug;
        logger.setDebug(this.settings.debug);
        await this.saveSettings();
        new Notice(`Debug mode ${this.settings.debug ? 'enabled' : 'disabled'}`);
      },
    });

    // Register extensions for CodeMirror
    this.registerEditorExtension([
      createCommandInputExtension(COMMAND_PREFIXES, {
        onEnter: this.handleEnter.bind(this),
      }),
    ]);

    this.registerMarkdownPostProcessor(
      createCalloutSearchResultPostProcessor({
        handleClick: event => {
          this.handleSearchResultCalloutClick(event);
        },
      })
    );

    this.registerMarkdownPostProcessor(
      createStewardConversationProcessor({
        conversationFolder: `${this.settings.stewardFolder}/Conversations`,
        handleCloseButtonClick: (event: MouseEvent, conversationPath: string) => {
          conversationPath = conversationPath.replace('.md', '');
          const conversationTitle = conversationPath.split('/').pop();
          this.closeConversation(conversationTitle as string);
          this.editor.focus();
        },
      })
    );

    // Register the custom view type
    this.registerView(STW_CONVERSATION_VIEW_CONFIG.type, leaf => new StewardConversationView(leaf));
  }

  private initializeClassifier() {
    const classifier = getClassifier(this.settings.llm.model);
    // Initialize embeddings
    retry(
      () =>
        classify({
          model: classifier,
          value: 'initialize',
        }),
      {
        initialDelay: 500,
      }
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Update logger debug setting
    logger.setDebug(this.settings.debug);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Handle the Enter key combination
   * @param view - The editor view
   * @returns True if the command was processed, false otherwise
   */
  private handleEnter(view: EditorView): boolean {
    const { state } = view;
    const { doc, selection } = state;

    // Get current line
    const pos = selection.main.head;
    const line = doc.lineAt(pos);
    const lineText = line.text;

    // Exit early if line doesn't start with '/'
    if (!lineText.startsWith('/')) {
      return false;
    }

    // Create an extended set of prefixes including custom commands
    const extendedPrefixes = [...COMMAND_PREFIXES];

    // Add user-defined command prefixes if available
    if (this.userDefinedCommandService) {
      const userDefinedCommands = this.userDefinedCommandService.getCommandNames();
      for (let i = 0; i < userDefinedCommands.length; i++) {
        extendedPrefixes.push('/' + userDefinedCommands[i]);
      }
    }

    // Sort prefixes by length (longest first) to ensure we match the most specific command
    extendedPrefixes.sort((a, b) => b.length - a.length);

    // Find the matching prefix (if any)
    const matchedPrefix = extendedPrefixes.find(prefix => lineText.startsWith(prefix));

    if (!matchedPrefix) {
      return false;
    }

    // Extract the command content (everything after the prefix)
    const commandQuery = lineText.trim().substring(matchedPrefix.length).trim();

    // Determine command type based on the prefix
    let commandType = matchedPrefix.substring(1); // Remove the / from the command

    // Handle special case for general command
    if (matchedPrefix === '/ ') {
      commandType = ' ';
    }

    logger.log('Command type:', commandType === ' ' ? 'general' : commandType);
    logger.log('Command query:', commandQuery);

    if (!this.commandProcessorService.validateCommandContent(commandType, commandQuery)) {
      logger.log(`Command content is required for ${commandType} command`);
      return true;
    }

    (async () => {
      try {
        // Look for a conversation link in the previous lines
        const conversationLink = this.findConversationLinkAbove(view);

        const folderPath = `${this.settings.stewardFolder}/Conversations`;
        const notePath = `${folderPath}/${conversationLink}.md`;

        if (this.app.vault.getAbstractFileByPath(notePath) && conversationLink) {
          await this.updateConversationNote({
            path: conversationLink,
            newContent: lineText,
            role: 'User',
            command: commandType,
          });

          // Insert a general command line
          view.dispatch({
            changes: {
              from: line.from,
              to: line.to,
              insert: '/ ',
            },
          });

          const lang = (await this.conversationRenderer.getConversationProperty(
            conversationLink,
            'lang'
          )) as string;

          // Emit the conversation note updated event
          eventEmitter.emit(Events.CONVERSATION_COMMAND_RECEIVED, {
            title: conversationLink,
            commands: [
              {
                commandType,
                query: commandQuery,
              },
            ],
            lang,
          });

          return true;
        }

        // Create a title now so we can safely refer to it later
        const now = DateTime.now();
        const formattedDate = now.toFormat('yyyy-MM-dd_HH-mm-ss');
        const title = `${commandType.trim() || 'General'} command ${formattedDate}`;

        await this.conversationRenderer.createConversationNote(title, commandType, commandQuery);

        // After the note is created, insert the link on the next tick
        setTimeout(() => {
          // Emit the conversation note created event
          eventEmitter.emit(Events.CONVERSATION_NOTE_CREATED, {
            view,
            line,
            title,
            commandQuery,
            commandType,
            // We don't know the language here, so we'll rely on automatic detection
          });
        }, 50);

        return true;
      } catch (error) {
        logger.error('Error in handleEnter:', error);
        new Notice(`Error processing command: ${error.message}`);
        return false;
      }
    })();

    return true;
  }

  /**
   * Gets or creates the leaf for the static conversation
   * @returns The leaf containing the static conversation
   */
  private getStaticConversationLeaf(): WorkspaceLeaf {
    // Try to find existing leaf by view type
    const leaves = this.app.workspace.getLeavesOfType(STW_CONVERSATION_VIEW_CONFIG.type);

    // Use the first leaf if available
    if (leaves.length > 0) {
      return leaves[0];
    }

    // If no leaf found, create a new one
    const leaf = this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      throw new Error('Failed to create or find a leaf for the static conversation');
    }

    return leaf;
  }

  async openStaticConversation({
    revealLeaf = true,
  }: { revealLeaf?: boolean } = {}): Promise<void> {
    try {
      // Get the configured folder for conversations
      const folderPath = this.settings.stewardFolder;
      const notePath = `${folderPath}/${this.staticConversationTitle}.md`;

      // Check if conversations folder exists, create if not
      const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }

      // Check if the static conversation note exists, create if not
      const noteExists = this.app.vault.getAbstractFileByPath(notePath);
      if (!noteExists) {
        // Build initial content
        const initialContent = '';

        // Create the conversation note
        await this.app.vault.create(notePath, initialContent);
      }

      // Get or create the leaf for the static conversation
      const leaf = this.getStaticConversationLeaf();

      // Use our custom view
      await leaf.setViewState({
        type: STW_CONVERSATION_VIEW_CONFIG.type,
        state: { file: notePath },
      });

      if (revealLeaf) {
        // Focus the editor
        this.app.workspace.revealLeaf(leaf);
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        // Set the cursor to the last line
        this.setCursorToEndOfFile();
      }
    } catch (error) {
      logger.error('Error opening static conversation:', error);
      new Notice(`Error opening static conversation: ${error.message}`);
    }
  }

  public setCursorToEndOfFile(editor = this.editor) {
    const lineNumber = editor.lineCount() - 1;
    const line = editor.getLine(lineNumber);
    editor.setCursor({
      line: lineNumber,
      ch: line.length,
    });
  }

  /**
   * Check if a position points to an empty line or an empty general command line in the document
   * @param doc - The document to check
   * @param pos - The position to check
   * @returns The line if it is empty or null if it is not
   */
  private emptyLine(doc: Text, pos: number): Line | null {
    // Check if position is within document bounds
    if (pos > doc.length) return null;

    const line = doc.lineAt(pos);

    if (line.text.trim() === '' || line.text === '/ ') {
      return line;
    }

    return null;
  }

  async closeConversation(conversationTitle: string): Promise<boolean> {
    try {
      if (!this.editor) {
        new Notice(i18next.t('ui.noActiveEditor', { conversationTitle }));
        return false;
      }

      const editorView = this.editor.cm;
      const { state } = editorView;
      const { doc } = state;

      // Get the current viewport lines rather than iterating the whole document
      const { from, to } = editorView.viewport;

      // Find the line containing the conversation link within the viewport
      let linkFrom = -1;
      let linkTo = -1;

      // Get the line at the start of the viewport
      let pos = from;
      while (pos <= to) {
        const line = doc.lineAt(pos);

        // Match both simple links ![[title]] and full path links ![[folder/Conversations/title]]
        const exactTitlePattern = new RegExp(`!\\[\\[${conversationTitle}\\]\\]`);
        const pathPattern = new RegExp(
          `!\\[\\[${this.settings.stewardFolder}\\/Conversations\\/${conversationTitle}\\]\\]`
        );

        if (pathPattern.test(line.text) || exactTitlePattern.test(line.text)) {
          linkFrom = line.from;
          linkTo = line.to;

          // Check first empty line
          const firstLine = this.emptyLine(doc, linkTo + 1);
          if (firstLine) {
            linkTo = firstLine.to;

            // Check second empty line
            const secondLine = this.emptyLine(doc, linkTo + 1);
            if (secondLine) {
              linkTo = secondLine.to;
            }
          }

          break;
        }
        // Move to the next line
        pos = line.to + 1;
      }

      if (linkFrom === -1) {
        new Notice(i18next.t('ui.conversationLinkNotFound', { conversationTitle }));
        return false;
      }

      // Remove the conversation link
      editorView.dispatch({
        changes: {
          from: linkFrom,
          to: linkTo,
          insert: '',
        },
      });

      return true;
    } catch (error) {
      console.error('Error closing conversation:', error);
      new Notice(i18next.t('ui.errorClosingConversation', { errorMessage: error.message }));
      return false;
    }
  }

  /**
   * Toggles the static conversation sidebar open or closed
   */
  private async toggleStaticConversation(): Promise<void> {
    // Find and click the right sidebar toggle button
    const toggleButton = document.querySelector('.sidebar-toggle-button.mod-right');
    if (toggleButton instanceof HTMLElement) {
      toggleButton.click();
    }
  }

  // Function to find a conversation link in the lines above the current cursor
  findConversationLinkAbove(view: EditorView): string | null {
    const { state } = view;
    const { doc, selection } = state;
    const currentLine = doc.lineAt(selection.main.head);

    // Check up to 10 lines above the current one
    let lineNumber = currentLine.number - 1;
    const minLineNumber = Math.max(1, currentLine.number - 10);

    while (lineNumber >= minLineNumber) {
      const line = doc.line(lineNumber);
      const text = line.text;

      // Check if this line contains a conversation link
      if (isConversationLink(text, this.settings.stewardFolder)) {
        // Extract the conversation title
        return extractConversationTitle(text);
      }

      lineNumber--;
    }

    return null;
  }

  /**
   * Inserts a conversation link into the editor
   */
  insertConversationLink(payload: ConversationNoteCreatedPayload) {
    const linkText = `![[${this.settings.stewardFolder}/Conversations/${payload.title}]]\n\n`;

    payload.view.dispatch({
      changes: {
        from: payload.line.from,
        to: payload.line.to,
        insert: linkText + '/ ',
      },
    });

    this.editor.setCursor({
      line: payload.line.number,
      ch: 3,
    });

    eventEmitter.emit(Events.CONVERSATION_LINK_INSERTED, {
      title: payload.title,
      commandType: payload.commandType,
      commandQuery: payload.commandQuery,
      lang: payload.lang,
    });
  }

  /**
   * Updates a conversation note with the given result
   */
  async updateConversationNote(params: {
    path: string;
    newContent: string;
    command?: string;
    role?: 'User' | 'Steward';
  }) {
    return this.conversationRenderer.updateConversationNote(params);
  }

  async addGeneratingIndicator(path: string, indicatorText: string): Promise<void> {
    return this.conversationRenderer.addGeneratingIndicator(path, indicatorText);
  }

  removeGeneratingIndicator(content: string): string {
    return this.conversationRenderer.removeGeneratingIndicator(content);
  }

  /**
   * Check if the search index is built and build it if needed
   */
  private async checkAndBuildIndexIfNeeded(): Promise<void> {
    try {
      const isIndexBuilt = await this.searchService.documentStore.isIndexBuilt();
      if (!isIndexBuilt) {
        // Build the index if it's not already built
        await this.searchService.indexer.indexAllFiles();
      }
    } catch (error) {
      logger.error('Error checking or building index:', error);
    }
  }

  /**
   * Securely get the decrypted API key for a specific provider
   * @param provider - The provider to get the API key for (e.g., 'openai', 'elevenlabs')
   * @returns The decrypted API key or empty string if not set
   */
  getDecryptedApiKey(provider: 'openai' | 'elevenlabs' | 'deepseek'): string {
    const encryptedKey = this.settings.apiKeys[provider];

    if (!encryptedKey) {
      return '';
    }

    try {
      return decrypt(encryptedKey, this.settings.saltKeyId);
    } catch (error) {
      logger.error(`Error decrypting ${provider} API key:`, error);
      throw new Error(`Could not decrypt ${provider} API key`);
    }
  }

  /**
   * Securely set and encrypt an API key for a specific provider
   * @param provider - The provider to set the API key for (e.g., 'openai', 'elevenlabs')
   * @param apiKey - The API key to encrypt and store
   */
  async setEncryptedApiKey(
    provider: 'openai' | 'elevenlabs' | 'deepseek',
    apiKey: string
  ): Promise<void> {
    try {
      // First encrypt the API key
      const encryptedKey = apiKey ? encrypt(apiKey, this.settings.saltKeyId) : '';

      // Update our settings
      this.settings.apiKeys[provider] = encryptedKey;

      // Save the settings
      await this.saveSettings();

      // Put the API key in the environment variable
      if (provider === 'openai') {
        console.log('Setting OPENAI_API_KEY', apiKey, encryptedKey);
        process.env.OPENAI_API_KEY = apiKey;
      } else if (provider === 'elevenlabs') {
        process.env.ELEVENLABS_API_KEY = apiKey;
      } else if (provider === 'deepseek') {
        process.env.DEEPSEEK_API_KEY = apiKey;
      }
    } catch (error) {
      logger.error(`Error encrypting ${provider} API key:`, error);
      throw new Error(`Could not encrypt ${provider} API key`);
    }
  }

  /**
   * Handle clicks on search-result callouts to navigate to the exact match position
   * @param event Mouse event
   */
  private async handleSearchResultCalloutClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'A') {
      logger.log('Click on a link, skipping', target);
      return;
    }

    const calloutEl = target.closest('.callout[data-callout="search-result"]') as HTMLElement;

    // We only handle search result callouts that have position data
    const { line, startLine, endLine, start, end, path } = calloutEl.dataset;

    // Make sure we have the line data at minimum
    if ((!line && (!startLine || !endLine)) || !start || !end) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Get the main leaf for opening the file
    const mainLeaf = await this.getMainLeaf();

    let file: TFile | null = null;

    // If path is provided, get that file
    if (path) {
      file = await this.mediaTools.findFileByNameOrPath(path);
    }

    // If no path or file not found, use current active file
    if (!file) {
      file = this.app.workspace.getActiveFile();

      if (!file) {
        return;
      }
    }

    // Open the file and scroll to the position
    await mainLeaf.openFile(file);

    const startLineNum = parseInt((startLine || line) as string);
    const endLineNum = parseInt((endLine || line) as string);
    const startPos = parseInt(start);
    const endPos = parseInt(end);

    // Add a longer delay to make sure the file is fully loaded and active
    setTimeout(() => {
      // Make sure the leaf is active and focused
      this.app.workspace.setActiveLeaf(mainLeaf, { focus: true });
      this.app.workspace.revealLeaf(mainLeaf);

      // Get the editor from the file view directly
      const view = mainLeaf.view;
      // @ts-ignore - Access the editor property which exists on MarkdownView but might not be in types
      const editor = view.editor as Editor & {
        cm: EditorView;
      };

      if (!editor) return;

      try {
        // Set cursor position first
        editor.setCursor({ line: startLineNum - 1, ch: 0 });

        // Handle text selection - now supporting multiple lines
        if (!isNaN(startLineNum) && !isNaN(endLineNum)) {
          const from = { line: startLineNum - 1, ch: startPos };
          const to = { line: endLineNum - 1, ch: endPos };

          // Select the text
          editor.setSelection(from, to);
        }

        // Use CM6 scrolling for precise positioning
        if (editor.cm) {
          const linePosition = { line: startLineNum - 1, ch: startPos || 0 };
          const offset = editor.posToOffset(linePosition);

          // Dispatch a scrolling effect to center the cursor
          editor.cm.dispatch({
            effects: EditorView.scrollIntoView(offset, {
              y: 'center',
              yMargin: 50,
            }),
          });
        }
      } catch (error) {
        console.error('Error navigating to line:', error);
      }
    });
  }

  async getMainLeaf(): Promise<WorkspaceLeaf> {
    return new Promise(resolve => {
      this.app.workspace.iterateRootLeaves(leaf => {
        resolve(leaf);
      });
    });
  }

  /**
   * Excludes specified folders from Obsidian search and updates the SearchService
   * @param foldersToExclude - Array of folder names to exclude from search
   */
  async excludeFoldersFromSearch(foldersToExclude: string[]): Promise<void> {
    try {
      // Get the app's config
      // @ts-ignore - Accessing internal Obsidian API
      const appConfig = this.app.vault.config || {};

      // Try to use the "Files & Links" > "Excluded files" setting which is the user-facing configuration
      if (!appConfig.userIgnoreFilters) {
        appConfig.userIgnoreFilters = [];
      }

      // Add each folder to the excluded lists if not already present
      for (const folder of foldersToExclude) {
        // User-facing exclude patterns (Files & Links > Excluded files)
        if (!appConfig.userIgnoreFilters.includes(folder)) {
          appConfig.userIgnoreFilters.push(folder);
        }
      }

      // Save the updated config
      // @ts-ignore - Accessing internal Obsidian API
      this.app.vault.saveConfig();

      // Update the SearchService excludeFolders if it's initialized
      if (this.searchService) {
        this.searchService.updateExcludeFolders([
          ...this.settings.excludedFolders,
          ...appConfig.userIgnoreFilters,
        ]);
      }
    } catch (error) {
      console.error('Failed to exclude folders from search:', error);
    }
  }
}
