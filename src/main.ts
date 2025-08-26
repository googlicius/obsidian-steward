import { Notice, Plugin, WorkspaceLeaf, addIcon } from 'obsidian';
import i18next from './i18n';
import StewardSettingTab from './settings';
import { EditorView } from '@codemirror/view';
import { createCommandInputExtension } from './cm/extensions/CommandInputExtension';
import { CommandInputService } from './services/CommandInputService';
import { createCalloutSearchResultPostProcessor } from './post-processors/CalloutSearchResultPostProcessor';
import { createUserMessageButtonsProcessor } from './post-processors/UserMessageButtonsProcessor';
import { createCalloutMetadataProcessor } from './post-processors/CalloutMetadataProcessor';
import { createStwSelectedPostProcessor } from './post-processors/StwSelectedPostProcessor';
import { ConversationEventHandler } from './services/ConversationEventHandler';
import { eventEmitter } from './services/EventEmitter';
import { ObsidianAPITools } from './tools/obsidianAPITools';
import { SearchService } from './solutions/search';
import { encrypt, decrypt, generateSaltKeyId } from './utils/cryptoUtils';
import { formatDateTime } from './utils/dateUtils';
import { logger } from './utils/logger';
import { ConversationRenderer } from './services/ConversationRenderer';
import { ConversationArtifactManager } from './services/ConversationArtifactManager';
import { ContentReadingService } from './services/ContentReadingService';
import { StewardPluginSettings } from './types/interfaces';
import { Line, Text } from '@codemirror/state';
import {
  DEFAULT_SETTINGS,
  ProviderNeedApiKey,
  SMILE_CHAT_ICON_ID,
  STW_CHAT_VIEW_CONFIG,
  TWO_SPACES_PREFIX,
} from './constants';
import { StewardChatView } from './views/StewardChatView';
import { Events } from './types/events';
import { createStewardConversationProcessor } from './post-processors/StewardConversationProcessor';
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
import stewardIcon from './assets/steward-icon.svg';
import { createStwSelectedBlocksExtension } from './cm/extensions/StwSelectedBlockExtension';
import { createStwSqueezedBlocksExtension } from './cm/extensions/StwSqueezedBlockExtension';

// Generate a random string for DB prefix
function generateRandomDbPrefix(): string {
  return `obsidian_steward_${Math.random().toString(36).substring(2, 10)}`;
}

export default class StewardPlugin extends Plugin {
  settings: StewardPluginSettings;
  obsidianAPITools: ObsidianAPITools;
  searchService: SearchService;
  chatTitle = 'Steward Chat';
  artifactManager: ConversationArtifactManager;
  conversationRenderer: ConversationRenderer;
  contentReadingService: ContentReadingService;
  commandProcessorService: CommandProcessorService;
  userDefinedCommandService: UserDefinedCommandService;
  conversationEventHandler: ConversationEventHandler;
  mediaTools: MediaTools;
  noteContentService: NoteContentService;
  llmService: LLMService;
  commandInputService: CommandInputService;

  get editor(): ObsidianEditor {
    return this.app.workspace.activeEditor?.editor as ObsidianEditor;
  }

  async onload() {
    await this.loadSettings();

    // Check and update missing settings
    let settingsUpdated = false;

    // Generate DB prefix if not already set
    if (!this.settings.searchDbPrefix) {
      this.settings.searchDbPrefix = generateRandomDbPrefix();
      settingsUpdated = true;
    }

    // Setup encryption salt if not already set
    if (!this.settings.saltKeyId) {
      this.settings.saltKeyId = generateSaltKeyId();
      settingsUpdated = true;
    }

    // Set encryption version if not already set
    if (!this.settings.encryptionVersion) {
      this.settings.encryptionVersion = 1;
      settingsUpdated = true;
    }

    if (settingsUpdated) {
      await this.saveSettings();
    }

    // Initialize the search service with the plugin instance
    this.searchService = SearchService.getInstance(this);

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

    // Search index will be built manually by user request

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

    const decryptedGoogleKey = this.getDecryptedApiKey('google');
    if (decryptedGoogleKey) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = decryptedGoogleKey;
    }

    const decryptedGroqKey = this.getDecryptedApiKey('groq');
    if (decryptedGroqKey) {
      process.env.GROQ_API_KEY = decryptedGroqKey;
    }

    const decryptedAnthropicKey = this.getDecryptedApiKey('anthropic');
    if (decryptedAnthropicKey) {
      process.env.ANTHROPIC_API_KEY = decryptedAnthropicKey;
    }

    // Register custom icon using imported SVG
    addIcon(SMILE_CHAT_ICON_ID, stewardIcon);

    // Add ribbon icon with custom icon
    this.addRibbonIcon(SMILE_CHAT_ICON_ID, i18next.t('ui.openStewardChat'), async () => {
      await this.openChat();
    });

    this.registerStuffs();

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new StewardSettingTab(this));

    // Initialize the content reading service
    this.contentReadingService = ContentReadingService.getInstance(this);

    // Initialize the UserDefinedCommandService
    this.userDefinedCommandService = UserDefinedCommandService.getInstance(this);

    // Initialize the ConversationRenderer
    this.conversationRenderer = ConversationRenderer.getInstance(this);

    // Initialize the ConversationArtifactManager
    this.artifactManager = ConversationArtifactManager.getInstance();

    // Initialize the conversation event handler
    this.conversationEventHandler = new ConversationEventHandler({ plugin: this });

    // Initialize the CommandProcessorService
    this.commandProcessorService = new CommandProcessorService(this);

    // Initialize the CommandInputService
    this.commandInputService = CommandInputService.getInstance(this);

    this.initializeClassifier();

    // Exclude steward folders from search
    this.excludeFoldersFromSearch([
      `${this.settings.stewardFolder}/Conversations`,
      `${this.settings.stewardFolder}/Commands`,
      'Excalidraw',
      'copilot*',
    ]);
  }

  onunload() {
    // Unload the search service
    this.searchService.unload();

    // Unload the conversation event handler
    this.conversationEventHandler.unload();
  }

  private registerStuffs() {
    // Add command for toggling chat
    this.addCommand({
      id: 'toggle-chat',
      name: 'Toggle chat',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();

        if (activeFile && activeFile.name.startsWith(this.chatTitle)) {
          this.toggleChat();
        } else {
          this.openChat();
        }
      },
    });

    // Command to toggle debug mode
    this.addCommand({
      id: 'toggle-debug-mode',
      name: 'Toggle debug mode',
      callback: async () => {
        this.settings.debug = !this.settings.debug;
        logger.setDebug(this.settings.debug);
        await this.saveSettings();
        new Notice(`Debug mode ${this.settings.debug ? 'enabled' : 'disabled'}`);
      },
    });

    // Register extensions for CodeMirror
    this.registerEditorExtension([
      createCommandInputExtension(this, {
        onEnter: this.handleEnter.bind(this),
        onTyping: this.handleTyping.bind(this),
        typingDebounceMs: 1000,
      }),
      createStwSelectedBlocksExtension(this),
      createStwSqueezedBlocksExtension(this),
    ]);

    // Register context menu for editor
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        // Only show the menu item if there's a selection
        const selection = editor.getSelection();
        if (!selection || selection.trim() === '') {
          return;
        }

        // Add separator before our menu item
        menu.addSeparator();

        // Add our menu items
        menu.addItem(item => {
          item
            .setTitle(i18next.t('ui.addToInlineConversation'))
            .setIcon(STW_CHAT_VIEW_CONFIG.icon)
            .onClick(async () => {
              await this.commandInputService
                .withEditor(editor)
                .addSelectionToConversation('inline');
            });
        });

        menu.addItem(item => {
          item
            .setTitle(i18next.t('ui.addToChat'))
            .setIcon(STW_CHAT_VIEW_CONFIG.icon)
            .onClick(async () => {
              await this.commandInputService.withEditor(editor).addSelectionToConversation('chat');
            });
        });
      })
    );

    // Register the metadata processor first so other processors can use the metadata
    this.registerMarkdownPostProcessor(createCalloutMetadataProcessor());

    this.registerMarkdownPostProcessor(createCalloutSearchResultPostProcessor(this));

    this.registerMarkdownPostProcessor(createUserMessageButtonsProcessor(this));

    this.registerMarkdownPostProcessor(createStewardConversationProcessor(this));

    this.registerMarkdownPostProcessor(createStwSelectedPostProcessor(this));

    // Register the custom view type
    this.registerView(STW_CHAT_VIEW_CONFIG.type, leaf => new StewardChatView(leaf, this));
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

    // Apply bordered input class if enabled
    document.body.classList.toggle('stw-bordered-input', this.settings.borderedInput);
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

    // Check if this is a continuation line
    if (this.commandInputService.isContinuationLine(lineText)) {
      // Find the command line above
      let currentLineNum = line.number;
      let commandLine: Line | null = null;

      // Search upwards for the command line
      while (currentLineNum > 1) {
        currentLineNum--;
        const prevLine = doc.line(currentLineNum);

        // If we find a non-continuation line that's not a command, break
        if (!prevLine.text.startsWith(TWO_SPACES_PREFIX) && !prevLine.text.startsWith('/')) {
          break;
        }

        // If we find a command line, use it
        if (prevLine.text.startsWith('/')) {
          commandLine = prevLine;
          break;
        }
      }

      // If we found a command line, process the entire block
      if (commandLine) {
        return this.processCommandBlock(view, commandLine);
      }

      return false;
    }

    // Exit early if line doesn't start with '/'
    if (!lineText.startsWith('/')) {
      return false;
    }

    return this.processCommandBlock(view, line);
  }

  /**
   * Process a command block (command line + continuation lines)
   * @param view - The editor view
   * @param commandLine - The command line
   * @returns True if the command was processed, false otherwise
   */
  private processCommandBlock(view: EditorView, commandLine: Line): boolean {
    const commandBlock = this.commandInputService.getCommandBlock(view, commandLine);

    const fullCommandText = this.commandInputService.getCommandBlockContent(commandBlock);

    // Find the matching prefix (if any)
    const extendedPrefixes = this.userDefinedCommandService.buildExtendedPrefixes();
    const matchedPrefix = extendedPrefixes.find(prefix => commandLine.text.startsWith(prefix));

    if (!matchedPrefix) {
      return false;
    }

    // Determine command type based on the prefix
    let commandType = matchedPrefix.substring(1); // Remove the / from the command

    // Handle special case for general command
    if (matchedPrefix === '/ ') {
      commandType = ' ';
    }

    logger.log('Command type:', commandType === ' ' ? 'general' : commandType);
    logger.log('Command query:', fullCommandText);

    const commandQuery = fullCommandText.substring(matchedPrefix.length).trim();

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

        if (this.app.vault.getFileByPath(notePath) && conversationLink) {
          await this.updateConversationNote({
            path: conversationLink,
            newContent: fullCommandText,
            role: 'User',
            command: commandType,
          });

          // Clear all lines in the command block
          const lastLine = commandBlock[commandBlock.length - 1];
          view.dispatch({
            changes: {
              from: commandLine.from,
              to: lastLine.to,
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
        const formattedDate = formatDateTime();
        const title = `${commandType.trim() || 'General'} command ${formattedDate}`;

        await this.conversationRenderer.createConversationNote(title, commandType, commandQuery);

        // Insert the conversation link directly here instead of using the event
        const linkText = `![[${this.settings.stewardFolder}/Conversations/${title}]]\n\n`;

        // Clear all lines in the command block and insert the link
        const lastLine = commandBlock[commandBlock.length - 1];
        view.dispatch({
          changes: {
            from: commandLine.from,
            to: lastLine.to,
            insert: linkText + '/ ',
          },
        });

        // Set cursor position after the command prefix
        if (this.editor) {
          this.editor.setCursor({
            line: commandLine.number,
            ch: 3,
          });
        }

        // Emit the conversation link inserted event
        eventEmitter.emit(Events.CONVERSATION_LINK_INSERTED, {
          title,
          commandType,
          commandQuery,
          // We don't know the language here, the extraction will update it later
        });

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
   * Handle typing in command input to trigger summarization when appropriate
   */
  private async handleTyping(event: KeyboardEvent, view: EditorView): Promise<void> {
    const { state } = view;
    const { doc, selection } = state;

    const line = doc.lineAt(selection.main.head);

    if ('general' !== this.commandInputService.getInputPrefix(line, doc)) {
      return;
    }

    const conversationTitle = this.findConversationLinkAbove(view);

    if (!conversationTitle) return;

    try {
      // Check if we need to generate a summary
      await this.checkAndGenerateSummary(conversationTitle);
    } catch (error) {
      logger.error('Error in handleTyping:', error);
    }
  }

  /**
   * Check if we need to generate a summary and do so if needed
   * @param conversationTitle The conversation title
   */
  private async checkAndGenerateSummary(conversationTitle: string): Promise<void> {
    try {
      // Get all messages from the conversation
      const allMessages =
        await this.conversationRenderer.extractAllConversationMessages(conversationTitle);

      if (this.commandProcessorService.isProcessing(conversationTitle)) {
        logger.log('Commands are in processing, skipping summary generation');
        return;
      }

      let shouldRunSummary = false;

      // Check messages from newest to oldest
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const message = allMessages[i];

        // If we find a summary message first, no need to generate a new summary
        if (message.command === 'summary') {
          break;
        }

        // Stopped generation, no need to summarize
        if (message.command === 'stop') {
          break;
        }

        // If we find a generate message first, we need to generate a summary
        if (message.command === 'generate') {
          shouldRunSummary = true;
          break;
        }
      }

      if (shouldRunSummary) {
        logger.log('Generating summary for conversation:', conversationTitle);

        await this.commandProcessorService.processCommands(
          {
            title: conversationTitle,
            commands: [
              {
                commandType: 'summary',
                query: '',
              },
            ],
          },
          {
            skipIndicators: true,
          }
        );

        logger.log('Summary generated successfully for conversation:', conversationTitle);
      }
    } catch (error) {
      logger.error('Error checking and generating summary:', error);
    }
  }

  /**
   * Gets or creates the leaf for the chat
   * @returns The leaf containing the chat
   */
  public getChatLeaf(): WorkspaceLeaf {
    // Try to find existing leaf by view type
    const leaves = this.app.workspace.getLeavesOfType(STW_CHAT_VIEW_CONFIG.type);

    // Use the first leaf if available
    if (leaves.length > 0) {
      return leaves[0];
    }

    // If no leaf found, create a new one
    const leaf = this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      throw new Error('Failed to create or find a leaf for the chat');
    }

    return leaf;
  }

  public async openChat({ revealLeaf = true }: { revealLeaf?: boolean } = {}): Promise<void> {
    try {
      // Get the configured folder for conversations
      const folderPath = this.settings.stewardFolder;
      const notePath = `${folderPath}/${this.chatTitle}.md`;

      // Check if conversations folder exists, create if not
      const folderExists = this.app.vault.getFolderByPath(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }

      // Check if the chat note exists, create if not
      const noteExists = this.app.vault.getFileByPath(notePath);
      if (!noteExists) {
        // Build initial content
        const initialContent = '';

        // Create the chat note
        await this.app.vault.create(notePath, initialContent);
      }

      const leaf = this.getChatLeaf();

      // Use our custom view
      await leaf.setViewState({
        type: STW_CHAT_VIEW_CONFIG.type,
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
      logger.error('Error opening chat:', error);
      new Notice(`Error opening chat: ${error.message}`);
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

  async closeConversation(
    conversationTitle: string,
    action: 'close' | 'squeeze' = 'close'
  ): Promise<boolean> {
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
          insert: action === 'squeeze' ? '{{stw-squeezed [[' + conversationTitle + ']] }}' : '',
        },
      });

      return true;
    } catch (error) {
      logger.error('Error closing conversation:', error);
      new Notice(i18next.t('ui.errorClosingConversation', { errorMessage: error.message }));
      return false;
    }
  }

  /**
   * Toggles the chat sidebar open or closed
   */
  public async toggleChat(): Promise<void> {
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
   * Get the decrypted API key for a specific provider
   * @param provider - The provider to get the API key for (e.g., 'openai', 'elevenlabs', 'deepseek', 'google', 'groq')
   * @returns The decrypted API key or empty string if not set
   */
  getDecryptedApiKey(provider: ProviderNeedApiKey): string {
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
   * @param provider - The provider to set the API key for (e.g., 'openai', 'elevenlabs', 'deepseek', 'google', 'groq')
   * @param apiKey - The API key to encrypt and store
   */
  async setEncryptedApiKey(provider: ProviderNeedApiKey, apiKey: string): Promise<void> {
    try {
      // First encrypt the API key
      const encryptedKey = apiKey ? encrypt(apiKey, this.settings.saltKeyId) : '';

      // Update our settings
      this.settings.apiKeys[provider] = encryptedKey;

      // Save the settings
      await this.saveSettings();

      // Put the API key in the environment variable
      if (provider === 'openai') {
        logger.log('Setting OPENAI_API_KEY', apiKey, encryptedKey);
        process.env.OPENAI_API_KEY = apiKey;
      } else if (provider === 'elevenlabs') {
        process.env.ELEVENLABS_API_KEY = apiKey;
      } else if (provider === 'deepseek') {
        process.env.DEEPSEEK_API_KEY = apiKey;
      } else if (provider === 'google') {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
      } else if (provider === 'groq') {
        process.env.GROQ_API_KEY = apiKey;
      } else if (provider === 'anthropic') {
        process.env.ANTHROPIC_API_KEY = apiKey;
      }
    } catch (error) {
      logger.error(`Error encrypting ${provider} API key:`, error);
      throw new Error(`Could not encrypt ${provider} API key`);
    }
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
      logger.error('Failed to exclude folders from search:', error);
    }
  }
}
