import { ConversationRenderer } from 'src/services/ConversationRenderer';
import { CommandIntent } from '../../lib/modelfusion/intentExtraction';
import StewardPlugin from '../../main';
import { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import { ConversationArtifactManager } from 'src/services/ConversationArtifactManager';
import { App } from 'obsidian';
import { StewardPluginSettings } from 'src/types/interfaces';

export enum CommandResultStatus {
	SUCCESS = 'success',
	ERROR = 'error',
	/**
	 * Commands should now handle their own confirmation logic or return SUCCESS or ERROR.
	 */
	NEEDS_CONFIRMATION = 'needs_confirmation',
}

export interface CommandResult {
	status: CommandResultStatus;
	error?: Error | string;
	confirmationMessage?: string;
	onConfirmation?: () => Promise<void> | void;
	onRejection?: () => Promise<void> | void;
}

export interface CommandHandlerParams {
	title: string;
	command: CommandIntent;
	prevCommand?: CommandIntent;
	nextCommand?: CommandIntent;
	lang?: string;
}

export abstract class CommandHandler {
	readonly plugin: StewardPlugin;

	get renderer(): ConversationRenderer {
		return this.plugin.conversationRenderer;
	}

	get artifactManager(): ConversationArtifactManager {
		return this.plugin.artifactManager;
	}

	get obsidianAPITools(): ObsidianAPITools {
		return this.plugin.obsidianAPITools;
	}

	get app(): App {
		return this.plugin.app;
	}

	get settings(): StewardPluginSettings {
		return this.plugin.settings;
	}

	/**
	 * Render a loading indicator for the command
	 * @param title The conversation title
	 * @param lang The language code
	 */
	public renderIndicator?(title: string, lang?: string): Promise<void>;

	/**
	 * Handle a command
	 */
	public abstract handle(params: CommandHandlerParams): Promise<CommandResult>;
}
