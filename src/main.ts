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
import { createExtractionDetailsLinkProcessor } from './post-processors/ExtractionDetailsLinkProcessor';
import { ConversationEventHandler } from './services/ConversationEventHandler';
import { eventEmitter } from './services/EventEmitter';
import { ObsidianAPITools } from './tools/obsidianAPITools';
import { SearchService } from './solutions/search';
import { SearchDatabase } from './database/SearchDatabase';
import { EncryptionService } from './services/EncryptionService';
import { generateId } from 'ai';
import { formatDateTime } from './utils/dateUtils';
import { logger } from './utils/logger';
import { ConversationRenderer } from './services/ConversationRenderer';
import { ArtifactManagerV2 } from './solutions/artifact/ArtifactManagerV2';
import { ContentReadingService } from './services/ContentReadingService';
import { StewardPluginSettings } from './types/interfaces';
import { Line, Text } from '@codemirror/state';
import {
  DEFAULT_SETTINGS,
  SEARCH_DB_NAME_PREFIX,
  SMILE_CHAT_ICON_ID,
  STW_CHAT_VIEW_CONFIG,
  TWO_SPACES_PREFIX,
} from './constants';
import { StewardChatView } from './views/StewardChatView';
import { Events } from './types/events';
import { createStewardConversationProcessor } from './post-processors/StewardConversationProcessor';
import { ObsidianEditor, ExtendedApp } from './types/types';
import { isConversationLink, extractConversationTitle } from './utils/conversationUtils';
import { CommandProcessorService } from './services/CommandProcessorService';
import { UserDefinedCommandService } from './services/UserDefinedCommandService';
import { retry } from './utils/retry';
import { getClassifier } from './lib/modelfusion/classifiers/getClassifier';
import { MediaTools } from './tools/mediaTools';
import { NoteContentService } from './services/NoteContentService';
import { LLMService } from './services/LLMService';
import stewardIcon from './assets/steward-icon.svg';
import { createStwSelectedBlocksExtension } from './cm/extensions/StwSelectedBlockExtension';
import { createStwSqueezedBlocksExtension } from './cm/extensions/StwSqueezedBlockExtension';
import { capitalizeString } from './utils/capitalizeString';
import { AbortService } from './services/AbortService';
import { TrashCleanupService } from './services/TrashCleanupService';
import { ModelFallbackService } from './services/ModelFallbackService';
import { uniqueID } from './utils/uniqueID';

export default class StewardPlugin extends Plugin {
  settings: StewardPluginSettings;
  obsidianAPITools: ObsidianAPITools;
  chatTitle = 'Steward chat';
  commandProcessorService: CommandProcessorService;
  conversationEventHandler: ConversationEventHandler;
  llmService: LLMService;
  trashCleanupService: TrashCleanupService;
  abortService: AbortService;

  // Lazy-loaded services
  _searchService: SearchService;
  _artifactManagerV2: ArtifactManagerV2;
  _conversationRenderer: ConversationRenderer;
  _contentReadingService: ContentReadingService;
  _userDefinedCommandService: UserDefinedCommandService;
  _mediaTools: MediaTools;
  _noteContentService: NoteContentService;
  _modelFallbackService: ModelFallbackService;
  _encryptionService: EncryptionService;
  _commandInputService: CommandInputService;

  get commandInputService(): CommandInputService {
    if (!this._commandInputService) {
      this._commandInputService = CommandInputService.getInstance(this);
    }
    return this._commandInputService;
  }

  get searchService(): SearchService {
    if (!this._searchService) {
      this._searchService = SearchService.getInstance(this);
    }
    return this._searchService;
  }

  get modelFallbackService(): ModelFallbackService {
    if (!this._modelFallbackService) {
      this._modelFallbackService = ModelFallbackService.getInstance(this);
    }
    return this._modelFallbackService;
  }

  get artifactManagerV2(): ArtifactManagerV2 {
    if (!this._artifactManagerV2) {
      this._artifactManagerV2 = ArtifactManagerV2.getInstance(this);
    }
    return this._artifactManagerV2;
  }

  get conversationRenderer(): ConversationRenderer {
    if (!this._conversationRenderer) {
      this._conversationRenderer = ConversationRenderer.getInstance(this);
    }
    return this._conversationRenderer;
  }

  get contentReadingService(): ContentReadingService {
    if (!this._contentReadingService) {
      this._contentReadingService = ContentReadingService.getInstance(this);
    }
    return this._contentReadingService;
  }

  get userDefinedCommandService(): UserDefinedCommandService {
    if (!this._userDefinedCommandService) {
      this._userDefinedCommandService = UserDefinedCommandService.getInstance(this);
    }
    return this._userDefinedCommandService;
  }

  get mediaTools(): MediaTools {
    if (!this._mediaTools) {
      this._mediaTools = MediaTools.getInstance(this.app);
    }
    return this._mediaTools;
  }

  get noteContentService(): NoteContentService {
    if (!this._noteContentService) {
      this._noteContentService = NoteContentService.getInstance(this);
    }
    return this._noteContentService;
  }

  get encryptionService(): EncryptionService {
    if (!this._encryptionService) {
      this._encryptionService = EncryptionService.getInstance(this);
    }
    return this._encryptionService;
  }

  get conversationRender(): ConversationRenderer {
    if (!this._conversationRenderer) {
      this._conversationRenderer = ConversationRenderer.getInstance(this);
    }
    return this._conversationRenderer;
  }

  get editor(): ObsidianEditor {
    return this.app.workspace.activeEditor?.editor as ObsidianEditor;
  }

  get extendedApp(): ExtendedApp {
    return this.app as ExtendedApp;
  }

  async onload() {
    const settingsUpdated = await this.loadSettings();

    if (settingsUpdated) {
      await this.saveSettings();
    }

    // Clean up old search databases
    this.cleanupOldSearchDatabases();

    // Initialize the search service
    await this.searchService.initialize();

    // Initialize the ObsidianAPITools with the SearchTool
    this.obsidianAPITools = new ObsidianAPITools(this.app);

    // Initialize the LLM service
    this.llmService = LLMService.getInstance(this);

    // Initialize the AbortService
    this.abortService = AbortService.getInstance();

    // Register custom icon using imported SVG
    addIcon(SMILE_CHAT_ICON_ID, stewardIcon);

    // Add ribbon icon with custom icon
    this.addRibbonIcon(SMILE_CHAT_ICON_ID, i18next.t('ui.openStewardChat'), async () => {
      await this.openChat();
    });

    this.registerStuffs();

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new StewardSettingTab(this));

    // Initialize the conversation event handler
    this.conversationEventHandler = new ConversationEventHandler({ plugin: this });

    // Initialize the CommandProcessorService
    this.commandProcessorService = new CommandProcessorService(this);

    // Initialize the TrashCleanupService
    this.trashCleanupService = new TrashCleanupService(this);
    this.trashCleanupService.initialize();

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
    // Remove the language attribute from the HTML element
    document.documentElement.removeAttribute('data-stw-language');

    // Unload the search service
    this.searchService.unload();

    // Cleanup the trash cleanup service
    this.trashCleanupService.cleanup();

    // Cleanup current database and remove saltKeyId from localStorage
    retry(async () => {
      const data = await this.loadData();
      if (!data) {
        const currentDbName = this.settings.search.searchDbName;

        if (currentDbName) {
          // Remove the current database
          await SearchDatabase.removeDatabaseByName(currentDbName);
        }

        // Remove saltKeyId from localStorage
        if (this.settings.saltKeyId) {
          this.encryptionService.removeEncryptionSalt(this.settings.saltKeyId);
        }

        logger.log('Plugin cleanup completed successfully');
      } else {
        throw new Error('The plugin seems not to be uninstalled yet.');
      }
    });
  }

  private registerStuffs() {
    // Add command for toggling chat
    this.addCommand({
      id: 'toggle-chat',
      name: 'Toggle chat',
      callback: async () => {
        const rightSplit = this.app.workspace.rightSplit;

        if (!rightSplit.collapsed) {
          rightSplit.collapse();
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

    this.registerMarkdownPostProcessor(createExtractionDetailsLinkProcessor());

    this.registerMarkdownPostProcessor(createStewardConversationProcessor(this));

    this.registerMarkdownPostProcessor(createStwSelectedPostProcessor(this));

    // Register the custom view type
    this.registerView(STW_CHAT_VIEW_CONFIG.type, leaf => new StewardChatView(leaf, this));
  }

  private initializeClassifier() {
    const classifier = getClassifier(this.settings.embedding);

    // Initialize embeddings
    retry(() => classifier.doClassify('initialize'), {
      initialDelay: 500,
    });
  }

  private async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Update logger debug setting
    logger.setDebug(this.settings.debug);

    // Check and update missing settings
    let settingsUpdated = false;

    // Ensure search object exists
    if (!this.settings.search) {
      this.settings.search = DEFAULT_SETTINGS.search;
      settingsUpdated = true;
    }

    // Migrate legacy searchDbPrefix/searchDbName to search.searchDbName
    if (!this.settings.search.searchDbName) {
      if (this.settings.searchDbName) {
        // Prefer explicitly set top-level value if present
        this.settings.search.searchDbName = this.settings.searchDbName;
      } else if (this.settings.searchDbPrefix) {
        // If searchDbPrefix exists, copy it
        this.settings.search.searchDbName = this.settings.searchDbPrefix;
      } else {
        // Generate new db name
        const vaultName = this.app.vault.getName();
        this.settings.search.searchDbName = `${SEARCH_DB_NAME_PREFIX}${vaultName}_${uniqueID()}`;
      }
      // Clear deprecated fields
      this.settings.searchDbName = undefined;
      this.settings.searchDbPrefix = undefined;
      settingsUpdated = true;
    }

    // Setup encryption salt if not already set
    if (!this.settings.saltKeyId) {
      this.settings.saltKeyId = generateId();
      settingsUpdated = true;
    }

    // Set encryption version if not already set
    if (!this.settings.encryptionVersion) {
      this.settings.encryptionVersion = 1;
      settingsUpdated = true;
    }

    // Initialize providerConfigs if not already set
    if (!this.settings.llm.providerConfigs) {
      this.settings.llm.providerConfigs = {};
      settingsUpdated = true;
    }

    // Initialize chat if not already set
    if (!this.settings.llm.chat) {
      this.settings.llm.chat = DEFAULT_SETTINGS.llm.chat;
      // Migrate legacy model to chat.model
      if (this.settings.llm.model) {
        const provider = LLMService.getInstance(this).getProviderFromModel(this.settings.llm.model);
        this.settings.llm.chat.model = `${provider.name}:${provider.modelId}`;
        this.settings.llm.model = undefined;
      }
      settingsUpdated = true;
    }

    // Initialize embedding if not already set
    if (!this.settings.embedding) {
      this.settings.embedding = DEFAULT_SETTINGS.embedding;
      settingsUpdated = true;
    }

    // Migrate embedding from llm.embedding to top-level embedding
    if (this.settings.llm.embedding) {
      // Migrate existing embedding settings
      this.settings.embedding.model = this.settings.llm.embedding.model;
      this.settings.embedding.customModels = this.settings.llm.embedding.customModels || [];
      // Keep enabled as true by default for existing users
      if (this.settings.embedding.enabled === undefined) {
        this.settings.embedding.enabled = true;
      }

      // Clear old embedding settings
      this.settings.llm.embedding = undefined;
      settingsUpdated = true;
    }

    // Migrate legacy embeddingModel to embedding.model
    if (this.settings.llm.embeddingModel) {
      this.settings.embedding.model = this.settings.llm.embeddingModel;
      this.settings.llm.embeddingModel = undefined;
      settingsUpdated = true;
    }

    // Initialize speech if not already set
    if (!this.settings.llm.speech) {
      this.settings.llm.speech = DEFAULT_SETTINGS.llm.speech;
      // Remove legacy config
      this.settings.audio = undefined;
      settingsUpdated = true;
    }

    // Initialize image model if not already set
    if (!this.settings.llm.image?.model) {
      this.settings.llm.image = DEFAULT_SETTINGS.llm.image;
      settingsUpdated = true;
    }

    // Migrate ollamaBaseUrl to providerConfigs if it exists
    if (this.settings.llm.ollamaBaseUrl) {
      if (!this.settings.llm.providerConfigs.ollama) {
        this.settings.llm.providerConfigs.ollama = {};
      }
      this.settings.llm.providerConfigs.ollama.baseUrl = this.settings.llm.ollamaBaseUrl;
      this.settings.llm.ollamaBaseUrl = undefined;
      settingsUpdated = true;
    }

    // Migrate deleteBehavior from string to object structure
    if (typeof this.settings.deleteBehavior === 'string') {
      this.settings.deleteBehavior = {
        behavior: this.settings.deleteBehavior as 'stw_trash' | 'obsidian_trash',
        cleanupPolicy: 'never', // Default cleanup policy for existing users
      };
      settingsUpdated = true;
    }

    return settingsUpdated;
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
          await this.conversationRenderer.updateConversationNote({
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
        const title = ['search', 'help', 'audio', 'image'].includes(commandType)
          ? capitalizeString(commandType)
          : `${capitalizeString(commandType.trim()) || 'General'} ${formattedDate}`;

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
      await this.checkAndGenerateSummary(conversationTitle, view, line);
    } catch (error) {
      logger.error('Error in handleTyping:', error);
    }
  }

  /**
   * Check if we need to generate a summary and do so if needed
   * @param conversationTitle The conversation title
   */
  private async checkAndGenerateSummary(
    conversationTitle: string,
    view: EditorView,
    line: Line
  ): Promise<void> {
    try {
      if (this.commandProcessorService.isProcessing(conversationTitle)) {
        logger.log('Commands are in processing, skipping summary generation');
        return;
      }

      // Get all messages from the conversation
      const allMessages =
        await this.conversationRenderer.extractAllConversationMessages(conversationTitle);

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
          const commandBlock = this.commandInputService.getCommandBlock(view, line);
          const fullCommandText = this.commandInputService.getCommandBlockContent(commandBlock);

          if (fullCommandText.substring(2) !== '') {
            shouldRunSummary = true;
          }
          break;
        }
      }

      if (shouldRunSummary) {
        logger.log('Generating summary for conversation:', conversationTitle);

        await this.commandProcessorService.commandProcessor.processCommandInIsolation(
          {
            title: conversationTitle,
            commands: [
              {
                commandType: 'summary',
                query: '',
              },
            ],
          },
          'summary',
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

  async getMainLeaf(): Promise<WorkspaceLeaf> {
    return this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
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

  /**
   * Clean up old search databases that are no longer in use
   * This removes databases with the "steward_search_" prefix for the current vault that are not the current one
   */
  private async cleanupOldSearchDatabases(): Promise<void> {
    try {
      const currentDbName = this.settings.search.searchDbName;

      if (!currentDbName) {
        logger.log('No current search database name found, skipping cleanup');
        return;
      }

      const vaultName = this.app.vault.getName();
      logger.log('Starting cleanup of old search databases for vault:', vaultName);
      const deletedDbs = await SearchDatabase.cleanupOldDatabases(currentDbName, vaultName);

      if (deletedDbs.length > 0) {
        logger.log(
          `Successfully cleaned up ${deletedDbs.length} old search database(s) for vault "${vaultName}"`
        );
      }
    } catch (error) {
      logger.error('Error during search database cleanup:', error);
    }
  }
}
