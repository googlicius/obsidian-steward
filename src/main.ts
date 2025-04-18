import { Editor, Notice, Plugin, TFile, WorkspaceLeaf, addIcon } from 'obsidian';
import i18next from './i18n';
import StewardSettingTab from './settings';
import { EditorView } from '@codemirror/view';
import { createCommandHighlightExtension } from './cm-extensions/CommandHighlightExtension';
import { ConversationEventHandler } from './services/ConversationEventHandler';
import { eventEmitter, Events } from './services/EventEmitter';
import { ObsidianAPITools } from './tools/obsidianAPITools';
import { SearchIndexer } from './searchIndexer';
import { DateTime } from 'luxon';
import { encrypt, decrypt, generateSaltKeyId } from './utils/cryptoUtils';
import { WorkflowManager } from './workflows/WorkflowManager';
import { ConfirmationEventHandler } from './services/ConfirmationEventHandler';

// Supported command prefixes
export const COMMAND_PREFIXES = ['/ ', '/move', '/search', '/calc', '/me', '/close', '/confirm'];
// Define custom icon ID
const SMILE_CHAT_ICON_ID = 'smile-chat-icon';

interface StewardPluginSettings {
	mySetting: string;
	encryptedOpenaiApiKey: string;
	saltKeyId: string; // Store just the key ID, not the actual salt
	conversationFolder: string;
	searchDbPrefix: string;
	encryptionVersion?: number; // Track the encryption version for future migrations
	staticConversationLeafId?: string; // ID of the leaf containing the static conversation
}

const DEFAULT_SETTINGS: StewardPluginSettings = {
	mySetting: 'default',
	encryptedOpenaiApiKey: '',
	saltKeyId: '', // Will be generated on first load
	conversationFolder: 'conversations',
	searchDbPrefix: '',
	encryptionVersion: 1, // Current version
	staticConversationLeafId: undefined,
};

export enum GeneratorText {
	Generating = 'Generating...',
	Searching = 'Searching...',
	Calculating = 'Calculating...',
	Moving = 'Moving files...',
	ExtractingMoveQuery = 'Understanding your move request...',
	ExtractingIntent = 'Understanding your request...',
}

// Generate a random string for DB prefix
function generateRandomDbPrefix(): string {
	return `obsidian_steward_${Math.random().toString(36).substring(2, 10)}`;
}

export default class StewardPlugin extends Plugin {
	settings: StewardPluginSettings;
	obsidianAPITools: ObsidianAPITools;
	searchIndexer: SearchIndexer;
	ribbonIcon: HTMLElement;
	staticConversationTitle = 'Steward Chat';
	workflowManager: WorkflowManager;
	confirmationEventHandler: ConfirmationEventHandler;

	get editor() {
		return this.app.workspace.activeEditor?.editor as Editor & {
			cm: EditorView;
		};
	}

	async onload() {
		await this.loadSettings();

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

		// Initialize the search indexer with the stored DB prefix and conversation folder
		this.searchIndexer = new SearchIndexer({
			app: this.app,
			dbName: this.settings.searchDbPrefix,
			conversationFolder: this.settings.conversationFolder,
		});
		this.obsidianAPITools = new ObsidianAPITools(this.app, this.searchIndexer);

		// Build the index if it's not already built
		this.checkAndBuildIndexIfNeeded();

		const decryptedKey = this.getDecryptedApiKey();
		if (decryptedKey) {
			process.env.OPENAI_API_KEY = decryptedKey;
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
		this.ribbonIcon = this.addRibbonIcon(
			SMILE_CHAT_ICON_ID,
			i18next.t('ui.openStewardChat'),
			async () => {
				await this.openStaticConversation();
			}
		);

		// Register the conversation extension for CodeMirror
		this.registerEditorExtension([createCommandHighlightExtension(COMMAND_PREFIXES)]);

		// Initialize the conversation event handler
		new ConversationEventHandler({ plugin: this });

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
					await this.searchIndexer.indexAllFiles();
					statusBarItemEl.setText('');
					new Notice('Building Search Index completed!');
				} catch (error) {
					console.error('Error building search index:', error);
					new Notice(i18next.t('ui.errorBuildingSearchIndex'));
				}
			},
		});

		// Add command to process command lines with Shift+Enter
		this.addCommand({
			id: 'process-shift-enter',
			name: 'Process Shift+Enter',
			hotkeys: [{ modifiers: ['Shift'], key: 'Enter' }],
			editorCallback: async (
				editor: Editor & {
					cm: EditorView;
				},
				view
			) => {
				// If handleShiftEnter returns false, execute default Shift+Enter behavior
				if (!(await this.handleShiftEnter(editor.cm))) {
					// Default behavior: insert a new line
					editor.replaceSelection('\n');
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new StewardSettingTab(this.app, this));

		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(
			document,
			'click',
			this.handleLinkClickOnStaticConversation.bind(this),
			true
		);

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		// Initialize the confirmation event handler
		this.confirmationEventHandler = new ConfirmationEventHandler(this);

		// Initialize the workflow manager
		this.workflowManager = new WorkflowManager(this.app, this);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Function to handle the Shift+Enter key combination
	async handleShiftEnter(view: EditorView): Promise<boolean> {
		const { state } = view;
		const { doc, selection } = state;

		// Get current line
		const pos = selection.main.head;
		const line = doc.lineAt(pos);
		const lineText = line.text;

		// Check if line starts with a command prefix
		const commandMatch = COMMAND_PREFIXES.find(prefix => lineText.trim().startsWith(prefix));
		console.log('Command match:', commandMatch);

		if (commandMatch) {
			try {
				// Extract the command content (everything after the prefix)
				const commandContent = lineText.trim().substring(commandMatch.length).trim();
				let commandType = commandMatch.substring(1); // Remove the / from the command

				console.log('Command type:', commandType);
				console.log('Command content:', commandContent);

				// Look for a conversation link in the previous lines
				const conversationLink = this.findConversationLinkAbove(view);

				// Get the command type on the client side
				if (conversationLink && commandType === ' ') {
					commandType = await this.getCommandTypeOnClient(commandContent);
				}

				const folderPath = this.settings.conversationFolder;
				const notePath = `${folderPath}/${conversationLink}.md`;

				if (this.app.vault.getAbstractFileByPath(notePath) && conversationLink) {
					await this.updateConversationNote(conversationLink, lineText, 'User');

					// Remove the current line
					view.dispatch({
						changes: {
							from: line.from,
							to: line.to,
							insert: '',
						},
					});

					// Emit the conversation note updated event
					eventEmitter.emit(Events.CONVERSATION_NOTE_UPDATED, {
						title: conversationLink,
						commandType,
						commandContent,
						// We don't know the language here, so we'll rely on automatic detection
					});

					return true;
				}

				// Create a title now so we can safely refer to it later
				const now = DateTime.now();
				const formattedDate = now.toFormat('yyyy-MM-dd_HH-mm-ss');
				const title = `${commandType.trim() || 'General'} command ${formattedDate}`;

				// Create a promise to create the conversation note
				await this.createConversationNote(title, commandType, commandContent);

				// After the note is created, insert the link on the next tick
				setTimeout(() => {
					// Emit the conversation note created event
					eventEmitter.emit(Events.CONVERSATION_NOTE_CREATED, {
						view,
						from: line.from,
						to: line.to,
						title,
						commandContent,
						commandType,
						// We don't know the language here, so we'll rely on automatic detection
					});
				}, 50);

				return true;
			} catch (error) {
				console.error('Error in handleShiftEnter:', error);
				new Notice(`Error processing command: ${error.message}`);
				return false;
			}
		}

		return false;
	}

	/**
	 * Checks if the command content explicitly indicates a close intent
	 * @param content The command content to check
	 * @returns True if the content explicitly indicates a close intent
	 */
	isCloseIntent(content: string): boolean {
		const normalizedContent = content.toLowerCase().trim();

		// Simple hardcoded list of close commands
		const closeCommands = [
			'close',
			'close this',
			'close conversation',
			'end',
			'exit',
			'đóng',
			'kết thúc',
			'閉じる',
			'終了',
		];

		// Check for exact match or starts with
		return closeCommands.some(command => normalizedContent === command);
	}

	/**
	 * Gets the command type on the client side
	 * @param commandContent The command content to check
	 * @returns The command type
	 */
	private async getCommandTypeOnClient(commandContent: string): Promise<string> {
		if (this.isCloseIntent(commandContent)) {
			return 'close';
		}

		// Check if this is a confirmation response without processing it
		if (this.confirmationEventHandler.isConfirmIntent(commandContent)) {
			return 'confirm';
		}

		return ' ';
	}

	/**
	 * Gets or creates the leaf for the static conversation
	 * @returns The leaf containing the static conversation
	 */
	private getStaticConversationLeaf(): WorkspaceLeaf {
		// Try to find existing leaf by ID first
		let leaf = this.settings.staticConversationLeafId
			? this.app.workspace.getLeafById(this.settings.staticConversationLeafId)
			: null;

		// If no leaf found by ID, create a new one
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				// Store the leaf ID for future reference
				// @ts-ignore - leaf.id exists but TypeScript doesn't know about it
				this.settings.staticConversationLeafId = leaf.id;
				this.saveSettings();
			}
		}

		if (!leaf) {
			throw new Error('Failed to create or find a leaf for the static conversation');
		}

		return leaf;
	}

	/**
	 * Creates (if needed) and opens the static conversation note in the right panel
	 */
	async openStaticConversation(): Promise<void> {
		try {
			// Get the configured folder for conversations
			const folderPath = this.settings.conversationFolder;
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
				const initialContent = `${i18next.t('ui.welcomeMessage')}\n\n/ `;

				// Create the conversation note
				await this.app.vault.create(notePath, initialContent);
			}

			// Get or create the leaf for the static conversation
			const leaf = this.getStaticConversationLeaf();

			// Open the note in the leaf
			await leaf.setViewState({
				type: 'markdown',
				state: { file: notePath },
			});

			// Focus the editor
			this.app.workspace.revealLeaf(leaf);
		} catch (error) {
			console.error('Error opening static conversation:', error);
			new Notice(`Error opening static conversation: ${error.message}`);
		}
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

			// Find the line containing the conversation link
			let linkFrom = -1;
			let linkTo = -1;

			// Find the line containing the conversation link
			for (let i = 1; i <= doc.lines; i++) {
				const line = doc.line(i);
				const linkMatch = line.text.match(new RegExp(`!\\[\\[${conversationTitle}\\]\\]`));
				if (linkMatch) {
					linkFrom = line.from;
					linkTo = line.to;
					break;
				}
			}

			if (linkFrom === -1) {
				new Notice(i18next.t('ui.conversationLinkNotFound', { conversationTitle }));
				return false;
			}

			// Remove the conversation link
			editorView.dispatch({
				changes: {
					from: linkFrom,
					to: linkTo + 1, // +1 to include the newline
					insert: '',
				},
			});

			// Check if we're trying to close the static conversation
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.name.startsWith(this.staticConversationTitle)) {
				// Find and click the right sidebar toggle button
				const toggleButton = document.querySelector('.sidebar-toggle-button.mod-right');
				if (toggleButton instanceof HTMLElement) {
					toggleButton.click();
				}
			}

			return true;
		} catch (error) {
			console.error('Error closing conversation:', error);
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

			// Look for inline link format: ![[conversation title]]
			const linkMatch = text.match(/!\[\[(.*?)\]\]/);
			if (linkMatch && linkMatch[1]) {
				return linkMatch[1]; // Return the conversation title
			}

			lineNumber--;
		}

		return null;
	}

	// Helper function to create a conversation note
	async createConversationNote(title: string, commandType: string, content: string): Promise<void> {
		try {
			// Get the configured folder for conversations
			const folderPath = this.settings.conversationFolder;
			const notePath = `${folderPath}/${title}.md`;

			// Check if conversations folder exists, create if not
			const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folderExists) {
				await this.app.vault.createFolder(folderPath);
			}

			// Build initial content based on command type
			let initialContent: string;

			switch (commandType) {
				case 'move':
				case 'search':
				case 'calc':
				case ' ':
					initialContent = `#gtp-4\n\n**User:** /${commandType.trim()} ${content}\n\n*${i18next.t('conversation.generating')}*`;
					break;

				default:
					initialContent = [
						`#gtp-4`,
						'',
						`/${commandType.trim()} ${content}`,
						'',
						`**Steward**: ${i18next.t('conversation.workingOnIt')}`,
						'',
					].join('\n');
					break;
			}

			// Create the conversation note
			await this.app.vault.create(notePath, initialContent);
		} catch (error) {
			console.error('Error creating conversation note:', error);
			new Notice(i18next.t('ui.errorCreatingNote', { errorMessage: error.message }));
			throw error;
		}
	}

	/**
	 * Inserts a conversation link into the editor
	 * @param view - The editor view
	 * @param from - The start position of the link
	 * @param to - The end position of the link
	 * @param title - The title of the conversation
	 * @param commandType - The type of command
	 * @param commandContent - The content of the command
	 * @param lang - Optional language code for the response
	 */
	insertConversationLink(
		view: EditorView,
		from: number,
		to: number,
		title: string,
		commandType: string,
		commandContent: string,
		lang?: string
	) {
		const linkText = `![[${title}]]\n\n`;

		view.dispatch({
			changes: {
				from,
				to,
				insert: linkText,
			},
		});

		eventEmitter.emit(Events.CONVERSATION_LINK_INSERTED, {
			title,
			commandType,
			commandContent,
			lang,
		});
	}

	/**
	 * Updates a conversation note with the given result
	 * @param path - The path of the conversation note
	 * @param newContent - The new content to update in the note
	 * @param role - The role of the note
	 */
	async updateConversationNote(path: string, newContent: string, role?: string): Promise<void> {
		try {
			const folderPath = this.settings.conversationFolder;
			const notePath = `${folderPath}/${path}.md`;

			// Get the current content of the note
			const file = this.app.vault.getAbstractFileByPath(notePath) as TFile;
			if (!file) {
				throw new Error(i18next.t('ui.noteNotFound', { notePath }));
			}

			let currentContent = await this.app.vault.read(file);

			// Remove the generating indicator and any trailing newlines
			currentContent = this.removeGeneratingIndicator(currentContent);

			// Add a separator line if the role is User
			if (role === 'User') {
				currentContent = `${currentContent}\n\n---`;
			}

			// Update the note
			const roleText = role ? `**${role}:** ` : '';
			await this.app.vault.modify(file, `${currentContent}\n\n${roleText}${newContent}`);
		} catch (error) {
			console.error('Error updating conversation note:', error);
			new Notice(i18next.t('ui.errorUpdatingConversation', { errorMessage: error.message }));
		}
	}

	async addGeneratingIndicator(path: string, indicatorText: GeneratorText): Promise<void> {
		const folderPath = this.settings.conversationFolder;
		const notePath = `${folderPath}/${path}.md`;
		const file = this.app.vault.getAbstractFileByPath(notePath) as TFile;
		if (!file) {
			throw new Error(i18next.t('ui.noteNotFound', { notePath }));
		}

		const currentContent = this.removeGeneratingIndicator(await this.app.vault.read(file));
		const newContent = `${currentContent}\n\n*${indicatorText}*`;
		await this.app.vault.modify(file, newContent);
	}

	removeGeneratingIndicator(content: string) {
		return content.replace(/\n\n\*.*?\.\.\.\*$/, '');
	}

	/**
	 * Check if the search index is built and build it if needed
	 */
	private async checkAndBuildIndexIfNeeded(): Promise<void> {
		// Check if the index is already built
		const isBuilt = await this.searchIndexer.isIndexBuilt();

		// If the index isn't built yet, build it after a short delay
		// to avoid blocking the UI when the plugin loads
		if (!isBuilt) {
			console.log(i18next.t('ui.searchIndexNotFound'));

			// Use setTimeout to delay the index building by 3 seconds
			// This ensures the plugin loads smoothly before starting the index build
			setTimeout(async () => {
				try {
					const statusBarItemEl = this.addStatusBarItem();
					statusBarItemEl.setText(i18next.t('ui.buildingIndexes'));
					await this.searchIndexer.indexAllFiles();
					statusBarItemEl.setText('');
				} catch (error) {
					console.error('Error building initial indexes:', error);
					new Notice(i18next.t('ui.errorBuildingInitialIndexes'));
				}
			}, 3000);
		}
	}

	/**
	 * Securely get the decrypted OpenAI API key
	 * @returns The decrypted API key or empty string if not set
	 */
	getDecryptedApiKey(): string {
		if (!this.settings.encryptedOpenaiApiKey || !this.settings.saltKeyId) {
			return '';
		}

		try {
			const decryptedKey = decrypt(this.settings.encryptedOpenaiApiKey, this.settings.saltKeyId);
			return decryptedKey;
		} catch (error) {
			console.error('Error decrypting API key:', error);
			// Throw the error so callers can handle it
			throw new Error(i18next.t('ui.decryptionError'));
		}
	}

	/**
	 * Securely set and encrypt the OpenAI API key
	 * @param apiKey - The API key to encrypt and store
	 */
	async setEncryptedApiKey(apiKey: string): Promise<void> {
		try {
			// If no key provided, clear the encrypted key
			if (!apiKey) {
				this.settings.encryptedOpenaiApiKey = '';
			} else {
				// Ensure we have a salt key ID
				if (!this.settings.saltKeyId) {
					this.settings.saltKeyId = generateSaltKeyId();
				}

				// Encrypt and store the API key
				this.settings.encryptedOpenaiApiKey = encrypt(apiKey, this.settings.saltKeyId);

				// Set the latest encryption version
				this.settings.encryptionVersion = 1;
			}

			// Update environment variable
			process.env.OPENAI_API_KEY = apiKey;

			// Save settings
			await this.saveSettings();
		} catch (error) {
			console.error('Error encrypting API key:', error);
			new Notice(i18next.t('ui.encryptionError'));
			throw error;
		}
	}

	private handleLinkClickOnStaticConversation(event: MouseEvent) {
		const target = event.target as HTMLElement;

		const isLink =
			target.classList.contains('internal-link') || target.closest('.cm-hmd-internal-link');
		if (isLink) {
			const activeFile = this.app.workspace.getActiveFile() as TFile;

			if (activeFile.name.startsWith(this.staticConversationTitle)) {
				event.preventDefault();
				event.stopPropagation();
			}
		}
	}
}
