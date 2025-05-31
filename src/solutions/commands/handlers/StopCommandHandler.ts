import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import StewardPlugin from 'src/main';
import { getTranslation } from 'src/i18n';
import { AbortService } from 'src/services/AbortService';
import { logger } from 'src/utils/logger';
import { delay } from 'src/utils/delay';

/**
 * Handler for the stop command
 */
export class StopCommandHandler extends CommandHandler {
	private abortService: AbortService;

	constructor(public readonly plugin: StewardPlugin) {
		super();
		this.abortService = AbortService.getInstance();
	}

	/**
	 * Handle the stop command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, lang } = params;
		const t = getTranslation(lang);

		// Get the count of active operations before stopping
		const activeOperationsCount = this.abortService.getActiveOperationsCount();

		this.abortService.abortAllOperations();

		// Log the action
		logger.log(`Stop command received - aborted all operations (${activeOperationsCount} active)`);

		// Prepare the response message
		let responseMessage = t('commands.stop.stopped');

		// Add count of operations if there were any
		if (activeOperationsCount > 0) {
			responseMessage = t('commands.stop.stoppedWithCount', { count: activeOperationsCount });
		} else {
			responseMessage = t('commands.stop.noActiveOperations');
		}

		await delay(200);

		await this.renderer.updateConversationNote({
			path: title,
			newContent: responseMessage,
			role: 'Steward',
		});

		return {
			status: CommandResultStatus.SUCCESS,
		};
	}
}
