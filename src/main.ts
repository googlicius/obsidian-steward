import {
  Notice,
  Platform,
  Plugin,
  WorkspaceLeaf,
  WorkspaceParent,
  addIcon,
  getLanguage,
} from 'obsidian';
import i18next from './i18n';
import StewardSettingTab from './settings';
import { EditorView } from '@codemirror/view';
import { createCommandInputExtension } from './cm/extensions/CommandInputExtension';
import { CommandInputService } from './services/CommandInputService';
import { createCalloutSearchResultPostProcessor } from './post-processors/CalloutSearchResultPostProcessor';
import { createUserMessageButtonsProcessor } from './post-processors/UserMessageButtonsProcessor';
import { createCalloutMetadataProcessor } from './post-processors/CalloutMetadataProcessor';
import { createStwSourcePostProcessor } from './post-processors/StwSourcePostProcessor';
import { createStewardConversationProcessor } from './post-processors/StewardConversationProcessor';
import { createHistoryPostProcessor } from './post-processors/HistoryPostProcessor';
import { createThinkingProcessPostProcessor } from './post-processors/ThinkingProcessPostProcessor';
import { createConfirmationButtonsProcessor } from './post-processors/ConfirmationButtonsProcessor';
import { createCalloutEditPreviewPostProcessor } from './post-processors/CalloutEditPreviewPostProcessor';
import { createConversationIndicatorProcessor } from './post-processors/ConversationIndicatorProcessor';
import { createCliTranscriptPostProcessor } from './post-processors/CliTranscriptPostProcessor';
import { createCliXtermPostProcessor } from './post-processors/CliXtermPostProcessor';
import { ConversationEventHandler } from './services/ConversationEventHandler';
import { eventEmitter } from './services/EventEmitter';
import { ObsidianAPITools } from './tools/obsidianAPITools';
import { SearchService } from './solutions/search';
import { SearchDatabase } from './database/SearchDatabase';
import { EncryptionService } from './services/EncryptionService';
import { formatDateTime } from './utils/dateUtils';
import { logger } from './utils/logger';
import { ConversationRenderer } from './services/ConversationRenderer';
import { ArtifactManagerV2 } from './solutions/artifact/ArtifactManagerV2';
import { ContentReadingService } from './services/ContentReadingService';
import { StewardPluginSettings } from './types/interfaces';
import { Line, Text } from '@codemirror/state';
import { DEFAULT_SETTINGS, SMILE_CHAT_ICON_ID, STW_CHAT_VIEW_CONFIG } from './constants';
import { StewardChatView } from './views/StewardChatView';
import { Events } from './types/events';
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
import { createStwSourceBlocksExtension } from './cm/extensions/StwSourceBlockExtension';
import { createStwSqueezedBlocksExtension } from './cm/extensions/StwSqueezedBlockExtension';
import { createAutocompleteExtension } from './cm/extensions/AutocompleteExtension';
import { capitalizeString } from './utils/capitalizeString';
import { AbortService } from './services/AbortService';
import { TrashCleanupService } from './services/TrashCleanupService';
import { ModelFallbackService } from './services/ModelFallbackService';
import { CommandTrackingService } from './services/CommandTrackingService';
import { VersionCheckerService } from './services/VersionCheckerService';
import { UserMessageService } from './services/UserMessageService';
import { GitHubResourceService } from './services/GitHubResourceService';
import { SkillService } from './services/SkillService';
import { GuardrailsRuleService } from './services/GuardrailsRuleService/GuardrailsRuleService';
import { CompactionOrchestrator } from './solutions/compaction';
import { SubagentSpawnService } from './services/SubagentSpawnService';
import { MCPService } from './services/MCPService';
import { runSettingsSchemaMigrations } from './settings/migrations/settingsSchemaMigrations';
import { CliSessionService } from './services/CliSessionService/CliSessionService';
import { PtyCompanionService } from './services/PtyCompanionService/PtyCompanionService';
import { NodePtyInstallerScriptService } from './services/NodePtyInstallerScriptService/NodePtyInstallerScriptService';
import { WikilinkForwardService } from './services/WikilinkForwardService/WikilinkForwardService';

export default class StewardPlugin extends Plugin {
  settings: StewardPluginSettings;
  chatTitle = 'Chat';
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
  _gitHubResourceService: GitHubResourceService;
  _skillService: SkillService;
  _mcpService: MCPService;
  _guardrailsRuleService: GuardrailsRuleService;
  _commandTrackingService: CommandTrackingService;
  _versionCheckerService: VersionCheckerService;
  _userMessageService: UserMessageService;
  _compactionOrchestrator: CompactionOrchestrator;
  _subAgentSpawnService: SubagentSpawnService;
  _obsidianAPITools: ObsidianAPITools;
  _commandProcessorService: CommandProcessorService;
  _cliSessionService: CliSessionService;
  _ptyCompanionService: PtyCompanionService;
  _wikilinkForwardService: WikilinkForwardService;

  get cliSessionService(): CliSessionService {
    if (!this._cliSessionService) {
      this._cliSessionService = new CliSessionService(this);
    }
    return this._cliSessionService;
  }

  get wikilinkForwardService(): WikilinkForwardService {
    if (!this._wikilinkForwardService) {
      this._wikilinkForwardService = new WikilinkForwardService(this);
    }
    return this._wikilinkForwardService;
  }

  get ptyCompanionService(): PtyCompanionService {
    if (!this._ptyCompanionService) {
      this._ptyCompanionService = new PtyCompanionService(this);
    }
    return this._ptyCompanionService;
  }

  get obsidianAPITools(): ObsidianAPITools {
    if (!this._obsidianAPITools) {
      this._obsidianAPITools = new ObsidianAPITools(this.app);
    }
    return this._obsidianAPITools;
  }

  get commandProcessorService(): CommandProcessorService {
    if (!this._commandProcessorService) {
      this._commandProcessorService = new CommandProcessorService(this);
    }
    return this._commandProcessorService;
  }

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

  get commandTrackingService(): CommandTrackingService {
    if (!this._commandTrackingService) {
      this._commandTrackingService = CommandTrackingService.getInstance(this);
    }
    return this._commandTrackingService;
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

  get versionCheckerService(): VersionCheckerService {
    if (!this._versionCheckerService) {
      this._versionCheckerService = VersionCheckerService.getInstance(this);
    }
    return this._versionCheckerService;
  }

  get userMessageService(): UserMessageService {
    if (!this._userMessageService) {
      this._userMessageService = UserMessageService.getInstance(this);
    }
    return this._userMessageService;
  }

  get gitHubResourceService(): GitHubResourceService {
    if (!this._gitHubResourceService) {
      this._gitHubResourceService = GitHubResourceService.getInstance(this);
    }
    return this._gitHubResourceService;
  }

  get skillService(): SkillService {
    if (!this._skillService) {
      this._skillService = SkillService.getInstance(this);
    }
    return this._skillService;
  }

  get guardrailsRuleService(): GuardrailsRuleService {
    if (!this._guardrailsRuleService) {
      this._guardrailsRuleService = GuardrailsRuleService.getInstance(this);
    }
    return this._guardrailsRuleService;
  }

  get mcpService(): MCPService {
    if (!this._mcpService) {
      this._mcpService = MCPService.getInstance(this);
    }
    return this._mcpService;
  }

  get subAgentSpawnService(): SubagentSpawnService {
    if (!this._subAgentSpawnService) {
      this._subAgentSpawnService = new SubagentSpawnService(this);
    }
    return this._subAgentSpawnService;
  }

  get compactionOrchestrator(): CompactionOrchestrator {
    if (!this._compactionOrchestrator) {
      this._compactionOrchestrator = new CompactionOrchestrator(this);
    }
    return this._compactionOrchestrator;
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

    // Initialize the TrashCleanupService
    this.trashCleanupService = new TrashCleanupService(this);
    this.trashCleanupService.initialize();

    // Initialize the SkillService (loads skills from Steward/Skills folder)
    // Access triggers lazy initialization and onLayoutReady will load all skills
    this.skillService;

    // Initialize the GuardrailsRuleService (loads rules from Steward/Rules folder)
    this.guardrailsRuleService;

    // Initialize the MCPService (loads MCP definitions from Steward/MCP folder)
    this.mcpService;

    if (Platform.isDesktopApp) {
      await this.ptyCompanionService.start();
    }

    this.app.workspace.onLayoutReady(async () => {
      // Clean up old search databases
      this.cleanupOldSearchDatabases();

      // Initialize the search service
      this.searchService.initialize();

      await this.initializeClassifier();

      // Ensure required folders exist
      this.ensureRequiredFolders();

      // Exclude steward folders from search
      this.excludeFoldersFromSearch([
        `${this.settings.stewardFolder}/Conversations`,
        `${this.settings.stewardFolder}/Commands`,
        'Excalidraw',
        'copilot*',
      ]);
    });
  }

  onunload() {
    this._cliSessionService?.disposeAll();
    void this._ptyCompanionService?.stop();

    // Remove the language attribute from the HTML element
    document.documentElement.removeAttribute('data-stw-language');

    // Unload the search service
    this.searchService.unload();

    // Cleanup the trash cleanup service
    this.trashCleanupService.cleanup();

    // Cleanup orphaned temp streaming files
    this.cleanupTempStreamFiles();

    if (this._mcpService) {
      void this._mcpService.closeAll();
    }

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
    // Register protocol handler for resource links (obsidian://steward-resource?type=...&name=...)
    this.registerObsidianProtocolHandler('steward-resource', async params => {
      const type = params.type as 'doc' | 'command' | 'image';
      const name = params.name;

      if (!type || !name) {
        return;
      }

      const decodedName = decodeURIComponent(name);
      let success = false;

      try {
        if (type === 'doc') {
          success = await this.gitHubResourceService.openDoc(decodedName);
        } else if (type === 'command') {
          success = await this.gitHubResourceService.openCommand(decodedName);
        } else if (type === 'image') {
          // Images are handled differently - they're embedded, not opened
          logger.warn('Image resources should be embedded, not opened directly');
          return;
        }

        if (!success) {
          new Notice(i18next.t('documentation.fetchFailed', { docName: decodedName }));
        }
      } catch (error) {
        logger.error('Error opening resource:', error);
        new Notice(i18next.t('documentation.fetchFailed', { docName: decodedName }));
      }
    });

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

    // Register global ESC key handler to stop running commands
    this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
      if (evt.key === 'Escape' && !evt.isComposing) {
        const activeOperationsCount = this.abortService.getActiveOperationsCount();
        if (activeOperationsCount > 0) {
          this.stopOperations();
          evt.stopPropagation();
        }
      }
    });

    // Register extensions for CodeMirror
    this.registerEditorExtension([
      createCommandInputExtension(this, {
        onEnter: this.handleEnter.bind(this),
        // onTyping: this.handleTyping.bind(this),
        typingDebounceMs: 1000,
      }),
      createStwSourceBlocksExtension(this),
      createStwSqueezedBlocksExtension(this),
      createAutocompleteExtension(this),
    ]);

    // Wire up event-driven conversation-forwarding rewrites.
    this.wikilinkForwardService.registerEvents();

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

    this.registerMarkdownPostProcessor(createCalloutEditPreviewPostProcessor());

    this.registerMarkdownPostProcessor(createUserMessageButtonsProcessor(this));

    this.registerMarkdownPostProcessor(createConversationIndicatorProcessor(this));

    this.registerMarkdownPostProcessor(createStewardConversationProcessor(this));

    this.registerMarkdownPostProcessor(createStwSourcePostProcessor(this));

    this.registerMarkdownPostProcessor(createThinkingProcessPostProcessor());

    this.registerMarkdownPostProcessor(createCliTranscriptPostProcessor());

    this.registerMarkdownPostProcessor(createCliXtermPostProcessor(this));

    this.registerMarkdownPostProcessor(createConfirmationButtonsProcessor(this));

    this.registerMarkdownPostProcessor(createHistoryPostProcessor(this));

    // Register the custom view type
    this.registerView(STW_CHAT_VIEW_CONFIG.type, leaf => new StewardChatView(leaf, this));
  }

  private async initializeClassifier() {
    const classifier = await getClassifier(this.settings.embedding);

    // Initialize embeddings
    retry(() => classifier.doClassify('initialize'), {
      initialDelay: 500,
    });
  }

  private async loadSettings() {
    const rawSettings = (await this.loadData()) as Partial<StewardPluginSettings> | null;
    const fromVersion = this.resolveSettingsSchemaVersion(rawSettings);

    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawSettings || {});
    this.settings.settingsSchemaVersion = fromVersion;

    const migrationResult = await runSettingsSchemaMigrations({
      plugin: this,
      settings: this.settings,
      fromVersion,
    });

    logger.setDebug(this.settings.debug);
    return migrationResult.changed;
  }

  private resolveSettingsSchemaVersion(rawSettings: Partial<StewardPluginSettings> | null): number {
    if (!rawSettings || typeof rawSettings !== 'object') {
      return 0;
    }

    if (!Number.isInteger(rawSettings.settingsSchemaVersion)) {
      return 0;
    }

    if ((rawSettings.settingsSchemaVersion as number) < 0) {
      return 0;
    }

    return rawSettings.settingsSchemaVersion as number;
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
        if (
          !this.commandInputService.isContinuationLine(prevLine.text) &&
          !prevLine.text.startsWith('/')
        ) {
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

    // Determine intent type based on the prefix
    let intentType = matchedPrefix.substring(1); // Remove the / from the command

    // Handle special case for general intent
    if (matchedPrefix === '/ ') {
      intentType = ' ';
    }

    const intentQuery = fullCommandText.substring(matchedPrefix.length).trim();

    if (!this.commandProcessorService.validateIntentContent(intentType, intentQuery)) {
      logger.log(`Intent content is required for ${intentType} intent`);
      return true;
    }

    (async () => {
      try {
        // Look for a conversation link in the previous lines
        const conversationTitle = this.findConversationTitleAbove(view);

        const folderPath = `${this.settings.stewardFolder}/Conversations`;
        const notePath = `${folderPath}/${conversationTitle}.md`;

        if (this.app.vault.getFileByPath(notePath) && conversationTitle) {
          await this.conversationRenderer.addUserMessage({
            path: conversationTitle,
            newContent: fullCommandText,
            includeHistory: false,
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
            conversationTitle,
            'lang'
          )) as string;

          // Emit the conversation note updated event
          eventEmitter.emit(Events.CONVERSATION_INTENT_RECEIVED, {
            title: conversationTitle,
            intents: [
              {
                type: intentType,
                query: intentQuery,
              },
            ],
            lang,
          });

          return true;
        }

        // Create a title now so we can safely refer to it later
        const formattedDate = formatDateTime();
        const rawTitle = ['search', 'help', 'audio', 'image'].includes(intentType)
          ? capitalizeString(intentType)
          : `${capitalizeString(intentType.trim()) || 'General'} ${formattedDate}`;
        const title = this.sanitizeVaultNoteTitle(rawTitle);

        const conversationLanguage = getLanguage();
        // const indicatorText = this.conversationRenderer.getIndicatorTextByIntentType(
        //   intentType,
        //   conversationLanguage
        // );
        await this.conversationRenderer.createConversationNote(title, {
          intent: {
            type: intentType,
            query: intentQuery,
          },
          properties: [
            { name: 'lang', value: conversationLanguage },
            // { name: 'indicator_text', value: indicatorText },
          ],
        });

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
          intentType,
          intentQuery,
          // We don't know the language here, the extraction will update it later
        });

        return true;
      } catch (error) {
        logger.error('Error in handleEnter:', error);
        return false;
      }
    })();

    return true;
  }

  public leafIsInRightSidebar(leaf: WorkspaceLeaf): boolean {
    for (let p: WorkspaceParent | null = leaf.parent; p; p = p.parent) {
      if (p === this.app.workspace.rightSplit) {
        return true;
      }
    }
    return false;
  }

  private async relocateChatLeafToDock(
    currentLeaf: WorkspaceLeaf,
    targetDock: 'main' | 'right'
  ): Promise<WorkspaceLeaf> {
    const collapseRightAfterMove = targetDock === 'main' && this.leafIsInRightSidebar(currentLeaf);

    const state = currentLeaf.getViewState();
    let newLeaf: WorkspaceLeaf;
    if (targetDock === 'right') {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (!rightLeaf) {
        throw new Error('Failed to get right sidebar leaf');
      }
      newLeaf = rightLeaf;
    } else {
      newLeaf = this.app.workspace.getLeaf('tab');
    }

    await newLeaf.setViewState(state);
    currentLeaf.detach();

    if (collapseRightAfterMove) {
      this.app.workspace.rightSplit.collapse();
    }

    return newLeaf;
  }

  /**
   * Gets or creates the leaf for the chat in the configured dock ({@link StewardPluginSettings.chatViewDock}).
   */
  public async getChatLeaf(): Promise<WorkspaceLeaf> {
    const dock = this.settings.chatViewDock;
    const leaves = this.app.workspace.getLeavesOfType(STW_CHAT_VIEW_CONFIG.type);

    if (leaves.length > 0) {
      const leaf = leaves[0];
      return leaf;
    }

    if (dock === 'right') {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        throw new Error('Failed to create or find a leaf for the chat');
      }
      return leaf;
    }

    return this.app.workspace.getLeaf('tab');
  }

  /**
   * Toggle chat between the right sidebar and the main editor; updates {@link StewardPluginSettings.chatViewDock}.
   */
  public async toggleChatDockFromView(currentLeaf: WorkspaceLeaf): Promise<void> {
    const newDoc: StewardPluginSettings['chatViewDock'] = this.leafIsInRightSidebar(currentLeaf)
      ? 'main'
      : 'right';
    this.settings.chatViewDock = newDoc;
    await this.saveSettings();

    const newLeaf = await this.relocateChatLeafToDock(currentLeaf, newDoc);
    await this.app.workspace.revealLeaf(newLeaf);
    this.app.workspace.setActiveLeaf(newLeaf);

    const commandInputService =
      newLeaf.view instanceof StewardChatView
        ? this.commandInputService.withEditor(newLeaf.view.editor)
        : this.commandInputService;

    setTimeout(() => {
      commandInputService.focus();
    }, 500);
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

      // Prefer new note name; migrate legacy "Steward chat.md" once if present
      let chatFile = this.app.vault.getFileByPath(notePath);
      if (!chatFile) {
        const legacyPath = `${folderPath}/Steward chat.md`;
        const legacyFile = this.app.vault.getFileByPath(legacyPath);
        if (legacyFile) {
          await this.app.fileManager.renameFile(legacyFile, notePath);
          chatFile = this.app.vault.getFileByPath(notePath);
        }
      }

      if (!chatFile) {
        await this.app.vault.create(notePath, '');
      }

      const leaf = await this.getChatLeaf();

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
   * Stop all running operations
   * Can be called from ESC key or stop command
   */
  private stopOperations(): void {
    const activeOperationsCount = this.abortService.getActiveOperationsCount();

    if (activeOperationsCount > 0) {
      this.abortService.abortAllOperations();
      logger.log(
        `Stop operations triggered - aborted all operations (${activeOperationsCount} active)`
      );
      new Notice(i18next.t('stop.stoppedWithCount', { count: activeOperationsCount }));
    }
  }

  // Function to find a conversation title in the lines above a target line
  public findConversationTitleAbove(view: EditorView, fromLineNumber?: number): string | null {
    const { state } = view;
    const { doc, selection } = state;
    const currentLine =
      fromLineNumber && fromLineNumber > 0
        ? doc.line(Math.min(fromLineNumber, doc.lines))
        : doc.lineAt(selection.main.head);

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

  public async getCurrentConversationModelLabel(params: {
    conversationTitle: string;
    forceRefresh?: boolean;
  }): Promise<string> {
    const conversationModel = await this.conversationRenderer.getConversationProperty<string>(
      params.conversationTitle,
      'model',
      params.forceRefresh
    );

    if (conversationModel) {
      return this.llmService.formatModelLabel(conversationModel);
    }

    return this.llmService.formatModelLabel(this.settings.llm.chat.model);
  }

  async getMainLeaf(): Promise<WorkspaceLeaf> {
    return this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
  }

  /**
   * Excludes specified folders from Obsidian search and updates the SearchService
   * @param foldersToExclude - Array of folder names to exclude from search
   */
  private async excludeFoldersFromSearch(foldersToExclude: string[]): Promise<void> {
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
   * Ensures required folders exist when the app is opened
   */
  private async ensureRequiredFolders(): Promise<void> {
    this.app.workspace.onLayoutReady(async () => {
      try {
        // Ensure stewardFolder exists
        await this.obsidianAPITools.ensureFolderExists(this.settings.stewardFolder);

        // Ensure Release notes folder exists
        const releaseNotesFolder = `${this.settings.stewardFolder}/Release notes`;
        await this.obsidianAPITools.ensureFolderExists(releaseNotesFolder);

        // Ensure Rules folder exists for guardrails
        const rulesFolder = `${this.settings.stewardFolder}/Rules`;
        await this.obsidianAPITools.ensureFolderExists(rulesFolder);

        // Ensure MCP folder exists for MCP definitions
        const mcpFolder = `${this.settings.stewardFolder}/MCP`;
        await this.obsidianAPITools.ensureFolderExists(mcpFolder);

        await new NodePtyInstallerScriptService(this).sync();
      } catch (error) {
        logger.error('Failed to ensure required folders:', error);
      }
    });
  }

  private cleanupTempStreamFiles(): void {
    const tmpFolder = this.app.vault.getFolderByPath(`${this.settings.stewardFolder}/tmp`);
    if (!tmpFolder) return;

    for (const child of tmpFolder.children) {
      if (child.name.startsWith('stw_stream_')) {
        this.app.vault.delete(child).catch(() => {
          // Ignore errors during cleanup
        });
      }
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

  private sanitizeVaultNoteTitle(name: string): string {
    const INVALID_VAULT_FILE_NAME_CHARS = /[*"<>:\\/|?]/g;
    const collapsed = name.replace(INVALID_VAULT_FILE_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) {
      return collapsed;
    }
    return 'Conversation';
  }
}
