import { TFile } from 'obsidian';
import { uniqueID } from '../utils/uniqueID';
import StewardPlugin from '../main';
import { getTranslation } from '../i18n';

export class ConversationRenderer {
	private readonly plugin: StewardPlugin;

	constructor(plugin: StewardPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Updates the command type in the comment block of the last user message
	 * @param title The conversation title
	 * @param commandType The extracted command type
	 */
	public async updateLastUserMessageCommand(title: string, commandType: string): Promise<void> {
		try {
			// Get the conversation file
			const folderPath = this.plugin.settings.conversationFolder;
			const notePath = `${folderPath}/${title}.md`;
			const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;

			if (!file) {
				throw new Error(`Note not found: ${notePath}`);
			}

			// Read the current content
			let content = await this.plugin.app.vault.read(file);

			// Find the last user message with a comment block
			const commentBlockRegex = /<!--ID:(.*?),ROLE:user,COMMAND:(.*?)-->/gi;
			const matches = Array.from(content.matchAll(commentBlockRegex));

			if (matches.length > 0) {
				// Get the last user message comment block
				const lastMatch = matches[matches.length - 1];
				const originalCommentBlock = lastMatch[0];
				const messageId = lastMatch[1];

				// Create the updated comment block with the new command type
				const updatedCommentBlock = `<!--ID:${messageId},ROLE:user,COMMAND:${commandType}-->`;

				// Replace only the last occurrence of the comment block
				const lastIndex = content.lastIndexOf(originalCommentBlock);
				if (lastIndex !== -1) {
					content =
						content.substring(0, lastIndex) +
						updatedCommentBlock +
						content.substring(lastIndex + originalCommentBlock.length);

					// Update the file
					await this.plugin.app.vault.modify(file, content);
				}
			}
		} catch (error) {
			console.error('Error updating comment block:', error);
			// Don't throw, as this is not a critical operation
		}
	}

	/**
	 * Updates a conversation note with the given content
	 */
	public async updateConversationNote({
		path,
		newContent,
		role,
		command,
	}: {
		path: string;
		newContent: string;
		command?: string;
		role?: string;
	}): Promise<string | undefined> {
		try {
			const folderPath = this.plugin.settings.conversationFolder;
			const notePath = `${folderPath}/${path}.md`;

			// Get the current content of the note
			const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;
			if (!file) {
				throw new Error(`Note not found: ${notePath}`);
			}

			let currentContent = await this.plugin.app.vault.read(file);

			// Remove the generating indicator and any trailing newlines
			currentContent = this.removeGeneratingIndicator(currentContent);
			let heading = '';

			// Add a separator line if the role is User
			if (role === 'User') {
				currentContent = `${currentContent}\n\n---`;
				heading = '##### ';
			}

			const { messageId, comment } = await this.buildMessageMetadata(path, { role, command });

			// Update the note
			const roleText = role ? `**${role}:** ` : '';
			await this.plugin.app.vault.modify(
				file,
				`${currentContent}\n\n${comment}\n${heading}${roleText}${newContent}`
			);

			// Return the message ID for referencing
			return messageId;
		} catch (error) {
			console.error('Error updating conversation note:', error);
			return undefined;
		}
	}

	private async buildMessageMetadata(
		title: string,
		{ role, command }: { role?: string; command?: string } = {}
	) {
		const messageId = uniqueID();
		const metadata: { [x: string]: any } = {
			ID: messageId,
			...(role && {
				ROLE: role.toLowerCase(),
			}),
			...(command && {
				COMMAND: command,
			}),
		};

		if (command === 'more') {
			const prevMoreMetadata = await this.findMostRecentMessageMetadata(title, command, 'user');
			metadata.PAGE = prevMoreMetadata ? parseInt(prevMoreMetadata.PAGE) + 1 : 2;
		}

		let metadataAsHTMLComment = '<!--';

		for (const [key, value] of Object.entries(metadata)) {
			metadataAsHTMLComment += `${key}:${value},`;
		}

		// Remove trailing comma and close comment
		metadataAsHTMLComment = metadataAsHTMLComment.slice(0, -1) + '-->';

		return {
			messageId,
			comment: metadataAsHTMLComment,
		};
	}

	/**
	 * Find the most recent message metadata with a specific command and role
	 * @param conversationTitle The conversation title
	 * @param command The command to look for
	 * @param role The role to look for (user or steward)
	 * @returns The message metadata, or null if not found
	 */
	public async findMostRecentMessageMetadata(
		conversationTitle: string,
		command: string,
		role: string
	): Promise<Record<string, string> | null> {
		try {
			// Get the conversation file
			const folderPath = this.plugin.settings.conversationFolder;
			const notePath = `${folderPath}/${conversationTitle}.md`;
			const file = this.plugin.app.vault.getAbstractFileByPath(notePath);

			if (!file) {
				throw new Error(`Note not found: ${notePath}`);
			}

			// Read the content
			const content = await this.plugin.app.vault.cachedRead(file as TFile);

			// Prepare the regular expression pattern
			const rolePattern = `,ROLE:${role.toLowerCase()}`;
			const commandPattern = `,COMMAND:${command}`;

			// Find all matching comment blocks
			const commentBlockRegex = new RegExp(
				`<!--ID:(.*?)${rolePattern}${commandPattern}.*?-->`,
				'gi'
			);
			const matches = Array.from(content.matchAll(commentBlockRegex));

			// Find the most recent match
			if (matches.length > 0) {
				const lastMatch = matches[matches.length - 1];
				const fullComment = lastMatch[0];

				// Parse all metadata fields
				const metadataObject: Record<string, string> = {};
				const metadataRegex = /([A-Z]+):([^,]+)(?=,|-->)/gi;
				let metadataMatch;

				while ((metadataMatch = metadataRegex.exec(fullComment)) !== null) {
					const [, key, value] = metadataMatch;
					metadataObject[key] = value;
				}

				return metadataObject;
			}

			return null;
		} catch (error) {
			console.error('Error finding message:', error);
			return null;
		}
	}

	/**
	 * Adds a generating indicator to a conversation note
	 */
	public async addGeneratingIndicator(path: string, indicatorText: string): Promise<void> {
		const folderPath = this.plugin.settings.conversationFolder;
		const notePath = `${folderPath}/${path}.md`;
		const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;
		if (!file) {
			throw new Error(`Note not found: ${notePath}`);
		}

		const currentContent = this.removeGeneratingIndicator(await this.plugin.app.vault.read(file));
		const newContent = `${currentContent}\n\n*${indicatorText}*`;
		await this.plugin.app.vault.modify(file, newContent);
	}

	/**
	 * Removes the generating indicator from the content
	 */
	public removeGeneratingIndicator(content: string): string {
		return content.replace(/\n\n\*.*?\.\.\.\*$/, '');
	}

	/**
	 * Creates a new conversation note
	 */
	public async createConversationNote(
		title: string,
		commandType: string,
		content: string,
		language?: string
	): Promise<void> {
		try {
			// Get the configured folder for conversations
			const folderPath = this.plugin.settings.conversationFolder;
			const notePath = `${folderPath}/${title}.md`;

			// Check if conversations folder exists, create if not
			const folderExists = this.plugin.app.vault.getAbstractFileByPath(folderPath);
			if (!folderExists) {
				await this.plugin.app.vault.createFolder(folderPath);
			}

			// Generate a message ID
			const messageId = uniqueID();

			// Get translation function with the appropriate language
			const t = getTranslation(language);

			// Build initial content based on command type
			let initialContent = `<!--ID:${messageId},ROLE:user,COMMAND:${commandType}-->\n##### **User:** /${commandType.trim()} ${content}\n\n`;

			switch (commandType) {
				case 'move':
					initialContent += `*${t('conversation.moving')}*`;
					break;
				case 'move_from_search_result':
					initialContent += `*${t('conversation.moving')}*`;
					break;
				case 'delete':
					initialContent += `*${t('conversation.deleting')}*`;
					break;
				case 'copy':
					initialContent += `*${t('conversation.copying')}*`;
					break;
				case 'search':
					initialContent += `*${t('conversation.searching')}*`;
					break;
				case 'calc':
					initialContent += `*${t('conversation.calculating')}*`;
					break;
				case 'image':
					initialContent += `*${t('conversation.generatingImage')}*`;
					break;
				case 'audio':
					initialContent += `*${t('conversation.generatingAudio')}*`;
					break;
				case ' ':
					initialContent += `*${t('conversation.generating')}*`;
					break;

				default:
					initialContent = [
						`<!--id:${messageId},role:user,command:${commandType}-->`,
						`/${commandType.trim()} ${content}`,
						'',
						`**Steward**: ${t('conversation.workingOnIt')}`,
						'',
					].join('\n');
					break;
			}

			// Create the conversation note
			await this.plugin.app.vault.create(notePath, initialContent);
		} catch (error) {
			console.error('Error creating conversation note:', error);
			throw error;
		}
	}

	/**
	 * Find message metadata by ID
	 * @param conversationTitle The conversation title
	 * @param messageId The message ID
	 * @returns The message metadata, or null if not found
	 */
	public async findMessageMetadataById(
		conversationTitle: string,
		messageId: string
	): Promise<Record<string, string> | null> {
		try {
			// Get the conversation file
			const folderPath = this.plugin.settings.conversationFolder;
			const notePath = `${folderPath}/${conversationTitle}.md`;
			const file = this.plugin.app.vault.getAbstractFileByPath(notePath);

			if (!file) {
				throw new Error(`Note not found: ${notePath}`);
			}

			// Read the content
			const content = await this.plugin.app.vault.cachedRead(file as TFile);

			// Find the comment block with the given ID
			const idPattern = `ID:${messageId}`;
			const commentBlockRegex = new RegExp(`<!--${idPattern}.*?-->`, 'gi');
			const matches = Array.from(content.matchAll(commentBlockRegex));

			// If a match is found, parse it into an object
			if (matches.length > 0) {
				const fullComment = matches[0][0];

				// Parse all metadata fields
				const metadataObject: Record<string, string> = {};
				const metadataRegex = /([A-Z]+):([^,]+)(?=,|-->)/gi;
				let metadataMatch;

				while ((metadataMatch = metadataRegex.exec(fullComment)) !== null) {
					const [, key, value] = metadataMatch;
					metadataObject[key] = value;
				}

				return metadataObject;
			}

			return null;
		} catch (error) {
			console.error('Error finding message metadata by ID:', error);
			return null;
		}
	}

	/**
	 * Update the metadata for a message
	 * @param conversationTitle The conversation title
	 * @param messageId The message ID
	 * @param newMetadata The updated metadata
	 */
	public async updateMessageMetadata(
		conversationTitle: string,
		messageId: string,
		newMetadata: Record<string, string>
	): Promise<boolean> {
		try {
			// Get the conversation file
			const folderPath = this.plugin.settings.conversationFolder;
			const notePath = `${folderPath}/${conversationTitle}.md`;
			const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;

			if (!file) {
				throw new Error(`Note not found: ${notePath}`);
			}

			// Read the current content
			let content = await this.plugin.app.vault.read(file);

			// Find the comment block with the given ID
			const idPattern = `ID:${messageId}`;
			const commentBlockRegex = new RegExp(`<!--${idPattern}.*?-->`, 'gi');
			const matches = Array.from(content.matchAll(commentBlockRegex));

			if (matches.length > 0) {
				// Get the existing comment block
				const originalCommentBlock = matches[0][0];

				// Create the updated comment block
				let updatedCommentBlock = '<!--';
				for (const [key, value] of Object.entries(newMetadata)) {
					updatedCommentBlock += `${key}:${value},`;
				}
				// Remove trailing comma and close comment
				updatedCommentBlock = updatedCommentBlock.slice(0, -1) + '-->';

				// Replace the comment block in the content
				content = content.replace(originalCommentBlock, updatedCommentBlock);

				// Update the file
				await this.plugin.app.vault.modify(file, content);
				return true;
			}

			return false;
		} catch (error) {
			console.error('Error updating message metadata:', error);
			return false;
		}
	}
}
