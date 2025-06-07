import { TFile, TFolder } from 'obsidian';
import StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { CommandIntent } from 'src/lib/modelfusion/extractions';

/**
 * Represents a command within a user-defined command sequence
 */
interface UserDefinedCommandStep {
	name: string;
	system_prompt?: string[] | string;
	query: string;
}

/**
 * Represents a user-defined command definition
 */
export interface UserDefinedCommand {
	command_name: string;
	description?: string;
	query_required?: boolean;
	commands: UserDefinedCommandStep[];
}

export class UserDefinedCommandService {
	public userDefinedCommands: Map<string, UserDefinedCommand> = new Map();
	private commandFolder: string;

	constructor(private plugin: StewardPlugin) {
		this.commandFolder = `${this.plugin.settings.stewardFolder}/Commands`;
		this.initialize();
	}

	/**
	 * Initialize the user-defined command service
	 */
	private async initialize(): Promise<void> {
		try {
			// Create the commands folder if it doesn't exist
			// const folderExists = this.plugin.app.vault.getAbstractFileByPath(this.commandFolder);
			// if (!folderExists) {
			// 	await this.plugin.app.vault.createFolder(this.commandFolder);
			// }

			// Load all command definitions
			await this.loadAllCommands();

			// Watch for changes to command files
			this.plugin.registerEvent(
				this.plugin.app.vault.on('modify', file => this.handleFileModification(file as TFile))
			);
			this.plugin.registerEvent(
				this.plugin.app.vault.on('create', file => this.handleFileCreation(file as TFile))
			);
			this.plugin.registerEvent(
				this.plugin.app.vault.on('delete', file => this.handleFileDeletion(file as TFile))
			);
		} catch (error) {
			logger.error('Error initializing UserDefinedCommandService:', error);
		}
	}

	/**
	 * Load all command definitions from the Commands folder
	 */
	private async loadAllCommands(): Promise<void> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(this.commandFolder);

		if (!(folder instanceof TFolder)) {
			return;
		}

		// Clear existing commands
		this.userDefinedCommands.clear();

		// Process all files in the folder
		for (const file of folder.children) {
			if (file instanceof TFile && file.extension === 'md') {
				await this.loadCommandFromFile(file);
			}
		}

		logger.log(`Loaded ${this.userDefinedCommands.size} user-defined commands`);
	}

	/**
	 * Load command definition from a file
	 */
	private async loadCommandFromFile(file: TFile): Promise<void> {
		try {
			const content = await this.plugin.app.vault.read(file);

			// Extract JSON blocks from the content
			const jsonBlocks = await this.extractJsonBlocks(content);

			for (const jsonContent of jsonBlocks) {
				try {
					const commandDefinition = JSON.parse(jsonContent) as UserDefinedCommand;

					if (this.validateCommandDefinition(commandDefinition)) {
						this.userDefinedCommands.set(commandDefinition.command_name, commandDefinition);
						logger.log(`Loaded user-defined command: ${commandDefinition.command_name}`);
					}
				} catch (jsonError) {
					logger.error(`Invalid JSON in file ${file.path}:`, jsonError);
				}
			}
		} catch (error) {
			logger.error(`Error loading command from file ${file.path}:`, error);
		}
	}

	/**
	 * Extract JSON blocks from markdown content
	 */
	private async extractJsonBlocks(content: string): Promise<string[]> {
		const jsonBlocks: string[] = [];
		const jsonRegex = /```json\s*([\s\S]*?)\s*```/gi;

		let match;
		while ((match = jsonRegex.exec(content)) !== null) {
			if (match[1]) {
				// Process any wiki links in the JSON content
				const jsonContent = await this.processContent(match[1]);
				jsonBlocks.push(jsonContent);
			}
		}

		return jsonBlocks;
	}

	/**
	 * Process content
	 * - Replace wiki links with the content of the linked note
	 * - Escape quotes and newlines to maintain valid JSON
	 */
	private async processContent(content: string): Promise<string> {
		// Find all wiki links in the content
		const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
		let match;
		let result = content;

		while ((match = wikiLinkRegex.exec(content)) !== null) {
			const fullMatch = match[0]; // The full match, e.g. [[Note Name]]
			const linkPath = match[1]; // The link path, e.g. Note Name

			// Try to find the file
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');

			if (file && file instanceof TFile) {
				try {
					// Read the file content
					const noteContent = await this.plugin.app.vault.read(file);

					// Replace the link with the content in the result
					// We need to escape quotes and newlines to maintain valid JSON
					const safeContent = noteContent
						.replace(/\\/g, '\\\\') // Escape backslashes
						.replace(/"/g, '\\"') // Escape quotes
						.replace(/\n/g, '\\n') // Escape newlines
						.replace(/\r/g, '\\r') // Escape carriage returns
						.replace(/\t/g, '\\t'); // Escape tabs

					result = result.replace(fullMatch, safeContent);
				} catch (error) {
					logger.error(`Error reading file content for ${fullMatch}:`, error);
				}
			} else {
				logger.warn(`Could not resolve link: ${fullMatch}`);
			}
		}

		return result;
	}

	/**
	 * Validate a command definition
	 */
	private validateCommandDefinition(command: UserDefinedCommand): boolean {
		if (!command.command_name || typeof command.command_name !== 'string') {
			logger.error('Invalid command: missing or invalid command_name');
			return false;
		}

		if (!Array.isArray(command.commands) || command.commands.length === 0) {
			logger.error(`Invalid command ${command.command_name}: missing or empty commands array`);
			return false;
		}

		if ('query_required' in command && typeof command.query_required !== 'boolean') {
			logger.error(`Invalid command ${command.command_name}: query_required must be a boolean`);
			return false;
		}

		for (const step of command.commands) {
			if (!step.name || typeof step.name !== 'string') {
				logger.error(`Invalid command ${command.command_name}: step missing name`);
				return false;
			}

			// Check system_prompt can be either a string or an array
			if ('system_prompt' in step) {
				if (!Array.isArray(step.system_prompt) && typeof step.system_prompt !== 'string') {
					logger.error(
						`Invalid command ${command.command_name}: system_prompt must be an array or string`
					);
					return false;
				}
			}

			if (!step.query || typeof step.query !== 'string') {
				logger.error(`Invalid command ${command.command_name}: step missing query`);
				return false;
			}
		}

		return true;
	}

	/**
	 * Handle file modification events
	 */
	private async handleFileModification(file: TFile): Promise<void> {
		if (this.isCommandFile(file)) {
			await this.loadCommandFromFile(file);
		}
	}

	/**
	 * Handle file creation events
	 */
	private async handleFileCreation(file: TFile): Promise<void> {
		if (this.isCommandFile(file)) {
			await this.loadCommandFromFile(file);
		}
	}

	/**
	 * Handle file deletion events
	 */
	private handleFileDeletion(file: TFile): void {
		if (this.isCommandFile(file)) {
			// Find and remove any commands from this file
			// Since we can't easily determine which command was in this file,
			// we'll reload all commands
			this.loadAllCommands();
		}
	}

	/**
	 * Check if a file is a command file
	 */
	private isCommandFile(file: TFile): boolean {
		return file.path.startsWith(this.commandFolder) && file.extension === 'md';
	}

	/**
	 * Get all user-defined command names for autocomplete
	 */
	public getCommandNames(): string[] {
		return Array.from(this.userDefinedCommands.keys());
	}

	/**
	 * Process a user-defined command with user input
	 */
	public processUserDefinedCommand(commandName: string, userInput: string): CommandIntent[] | null {
		const command = this.userDefinedCommands.get(commandName);

		if (!command) {
			return null;
		}

		// Convert the user-defined command steps to CommandIntent objects
		return command.commands.map(step => {
			// Replace $from_user placeholder with actual user input
			const content = step.query.replace('$from_user', userInput.trim());

			// Ensure systemPrompts is always an array
			let systemPrompts: string[] | undefined;

			if (step.system_prompt) {
				if (Array.isArray(step.system_prompt)) {
					systemPrompts = step.system_prompt;
				} else {
					// If it's a string, convert to an array with one element
					systemPrompts = [step.system_prompt];
				}
			}

			return {
				commandType: step.name,
				systemPrompts,
				content,
			};
		});
	}

	/**
	 * Check if a command name exists
	 */
	public hasCommand(commandName: string): boolean {
		return this.userDefinedCommands.has(commandName);
	}
}
