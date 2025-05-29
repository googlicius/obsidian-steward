import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { CommandProcessor } from '../CommandProcessor';

export class ConfirmCommandHandler extends CommandHandler {
	constructor(
		public readonly plugin: StewardPlugin,
		private readonly commandProcessor: CommandProcessor
	) {
		super();
	}

	/**
	 * Handle a confirmation command by checking if the previous command needs confirmation
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command, lang } = params;
		const t = getTranslation(lang);

		let commandContent = command.content;

		switch (command.commandType) {
			case 'yes':
				commandContent = 'yes';
				break;
			case 'no':
				commandContent = 'no';
				break;
		}

		const confirmationIntent = this.isConfirmIntent(commandContent);

		if (!confirmationIntent) {
			// If it's not a clear confirmation, let the user know
			await this.renderer.updateConversationNote({
				path: title,
				newContent: t('confirmation.notUnderstood'),
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error: t('confirmation.notUnderstood'),
			};
		}

		// Get the pending command data
		const pendingCommandData = this.commandProcessor.getPendingCommand(title);
		if (
			!pendingCommandData ||
			!pendingCommandData.lastCommandResult ||
			pendingCommandData.lastCommandResult.status !== CommandResultStatus.NEEDS_CONFIRMATION
		) {
			await this.plugin.conversationRenderer.updateConversationNote({
				path: title,
				newContent: t('confirmation.noPending'),
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error: t('confirmation.noPending'),
			};
		}

		const lastResult = pendingCommandData.lastCommandResult;

		// Handle the confirmation or rejection
		if (confirmationIntent.isAffirmative) {
			// Execute the confirmation callback
			if (lastResult.onConfirmation) {
				await lastResult.onConfirmation();
			}
		} else {
			if (lastResult.onRejection) {
				await lastResult.onRejection();
			}

			await this.plugin.conversationRenderer.updateConversationNote({
				path: title,
				newContent: t('confirmation.operationCancelled'),
				role: 'Steward',
			});
		}

		return {
			status: CommandResultStatus.SUCCESS,
		};
	}

	/**
	 * Check if a message is a clear confirmation response (yes/no)
	 * @param message The message to check
	 * @returns An object with the response type or null if not a clear response
	 */
	private isConfirmIntent(
		message: string
	): { isConfirmation: boolean; isAffirmative: boolean } | null {
		if (!message) {
			return {
				isAffirmative: true,
				isConfirmation: true,
			};
		}

		// Parse the user's response
		const normalized = message.toLowerCase().trim();

		const isAffirmative = [
			// English affirmative terms
			'yes',
			'y',
			'sure',
			'ok',
			'yeah',
			'yep',
			'create',
			'confirm',
			'proceed',
			// Vietnamese affirmative terms
			'có',
			'có nha',
			'đồng ý',
			'vâng',
			'ừ',
			'tạo',
			'tiếp tục',
		].some(term => normalized === term);

		const isNegative = [
			// English negative terms
			'no',
			'n',
			'nope',
			"don't",
			'dont',
			'cancel',
			'stop',
			// Vietnamese negative terms
			'không',
			'không nha',
			'đừng',
			'hủy',
			'dừng lại',
		].some(term => normalized === term);

		// If it matches either pattern, it's a confirmation
		if (isAffirmative || isNegative) {
			return {
				isConfirmation: true,
				isAffirmative: isAffirmative,
			};
		}

		// If not a clear response, return null
		return null;
	}
}
