import { Editor, Notice, Plugin, TFile } from 'obsidian';
import StewardSettingTab from './settings';
import { EditorView } from '@codemirror/view';
import { createCommandHighlightExtension } from './cm-extensions/CommandHighlightExtension';
import { ConversationEventHandler } from './services/ConversationEventHandler';
import { eventEmitter, Events } from './services/EventEmitter';
import { ObsidianAPITools } from './tools/obsidianAPITools';
import { SearchIndexer } from './searchIndexer';
import { DateTime } from 'luxon';
import { encrypt, decrypt, generateSaltKeyId } from './utils/cryptoUtils';

// Supported command prefixes
export const COMMAND_PREFIXES = ['/ ', '/move', '/search', '/calc', '/me', '/close'];

interface StewardPluginSettings {
	mySetting: string;
	encryptedOpenaiApiKey: string;
	saltKeyId: string; // Store just the key ID, not the actual salt
	conversationFolder: string;
	searchDbPrefix: string;
	encryptionVersion?: number; // Track the encryption version for future migrations
}

const DEFAULT_SETTINGS: StewardPluginSettings = {
	mySetting: 'default',
	encryptedOpenaiApiKey: '',
	saltKeyId: '', // Will be generated on first load
	conversationFolder: 'conversations',
	searchDbPrefix: '',
	encryptionVersion: 1, // Current version
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

		// Register the conversation extension for CodeMirror
		this.registerEditorExtension([createCommandHighlightExtension(COMMAND_PREFIXES)]);

		console.log('Registered conversation extension');

		// Initialize the conversation event handler
		new ConversationEventHandler({ plugin: this });

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();

		// Command to build search index
		this.addCommand({
			id: 'build-search-index',
			name: 'Build Search Index',
			callback: async () => {
				new Notice('Building search index...');
				try {
					statusBarItemEl.setText('Steward: Building indexes...');
					await this.searchIndexer.indexAllFiles();
					statusBarItemEl.setText('');
				} catch (error) {
					console.error('Error building search index:', error);
					new Notice('Error building search index. Check console for details.');
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

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
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

				// Handle close command
				if (conversationLink && commandType === ' ' && this.isCloseIntent(commandContent)) {
					commandType = 'close';
				}

				// Check if this is a follow-up message to an existing conversation
				if (commandType === 'me') {
					if (conversationLink) {
						// Handle the follow-up message
						this.handleFollowUpMessage(view, conversationLink, commandContent, line.from, line.to);
						return true;
					}
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
	 * Handles a command to close the current conversation
	 * @param conversationTitle The title of the conversation to close
	 * @returns True if the command was handled successfully
	 */
	async closeConversation(conversationTitle: string): Promise<boolean> {
		try {
			if (!this.editor) {
				new Notice(`No active editor to close conversation: ${conversationTitle}`);
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

			if (linkFrom !== -1) {
				// Remove the conversation link
				editorView.dispatch({
					changes: {
						from: linkFrom,
						to: linkTo + 1, // +1 to include the newline
						insert: '',
					},
				});

				new Notice(`Closed conversation: ${conversationTitle}`);
				return true;
			}

			// If we get here, we couldn't find the conversation link
			new Notice(`Could not locate the conversation link for ${conversationTitle}`);
			return false;
		} catch (error) {
			console.error('Error closing conversation:', error);
			new Notice(`Error closing conversation: ${error.message}`);
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

	// Function to handle a follow-up message to an existing conversation
	async handleFollowUpMessage(
		view: EditorView,
		conversationTitle: string,
		content: string,
		fromPos: number,
		toPos: number
	): Promise<void> {
		try {
			const folderPath = this.settings.conversationFolder;
			const notePath = `${folderPath}/${conversationTitle}.md`;

			// Check if the conversation note exists
			const file = this.app.vault.getAbstractFileByPath(notePath) as TFile;
			if (!file) {
				new Notice(`Error: Conversation note not found: ${notePath}`);
				return;
			}

			// Read the current content of the note
			const fileContent = await this.app.vault.read(file);

			// Append the follow-up message to the note
			const updatedContent =
				fileContent +
				`\n\n**User:** /me ${content}\n\n**Steward**: Working on follow-up request...\n`;

			// Update the note with the new content
			await this.app.vault.modify(file, updatedContent);

			// Replace the line with the command with an empty line
			view.dispatch({
				changes: {
					from: fromPos,
					to: toPos,
					insert: '',
				},
			});

			new Notice(`Added follow-up message to ${conversationTitle}`);
		} catch (error) {
			new Notice(`Error adding follow-up message: ${error}`);
			console.error('Error adding follow-up message:', error);
		}
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
					initialContent = `#gtp-4\n\n**User:** /${commandType.trim()} ${content}\n\n*Generating...*`;
					break;

				default:
					initialContent = [
						`#gtp-4`,
						'',
						`/${commandType.trim()} ${content}`,
						'',
						`**Steward**: Working on it...`,
						'',
					].join('\n');
					break;
			}

			// Create the conversation note
			await this.app.vault.create(notePath, initialContent);

			new Notice(`Created conversation: ${title}`);
		} catch (error) {
			console.error('Error creating conversation note:', error);
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
				throw new Error(`Conversation note not found: ${notePath}`);
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
			new Notice(`Error updating conversation: ${error.message}`);
		}
	}

	async addGeneratingIndicator(path: string, indicatorText: GeneratorText): Promise<void> {
		const folderPath = this.settings.conversationFolder;
		const notePath = `${folderPath}/${path}.md`;
		const file = this.app.vault.getAbstractFileByPath(notePath) as TFile;
		if (!file) {
			throw new Error(`Conversation note not found: ${notePath}`);
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
			console.log('Search index not found. Will build index shortly...');

			// Use setTimeout to delay the index building by 3 seconds
			// This ensures the plugin loads smoothly before starting the index build
			setTimeout(async () => {
				try {
					const statusBarItemEl = this.addStatusBarItem();
					statusBarItemEl.setText('Steward: Building indexes...');
					await this.searchIndexer.indexAllFiles();
					statusBarItemEl.setText('');
				} catch (error) {
					console.error('Error building initial indexes:', error);
					new Notice('Steward: Error building initial indexes. Check console for details.');
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
			throw new Error('Failed to decrypt API key. Please re-enter it in settings.');
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
			new Notice('Failed to encrypt API key. Please try again.');
			throw error;
		}
	}
}
