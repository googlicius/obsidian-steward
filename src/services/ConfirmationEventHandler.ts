import { eventEmitter } from './EventEmitter';
import {
	ConfirmationRequestPayload,
	ConfirmationResponsePayload,
	EventPayloadMap,
	Events,
} from '../types/events';
import StewardPlugin from '../main';
import { getTranslation } from '../i18n';
import { getObsidianLanguage } from '../utils/getObsidianLanguage';

interface PendingConfirmation {
	id: string;
	type: string; // Descriptive type (e.g., 'move-folders')
	conversationTitle: string;
	message: string;
	context: any; // Contains any additional data including language preference
	createdAt: number;
	// Event to trigger when confirmed
	onConfirmEvent?: {
		eventType: keyof EventPayloadMap; // The event to emit (must be a valid event)
		payload: any; // The payload to send with the event
	};
}

export class ConfirmationEventHandler {
	private plugin: StewardPlugin;
	private pendingConfirmations: Map<string, PendingConfirmation> = new Map();

	constructor(plugin: StewardPlugin) {
		this.plugin = plugin;
		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		// Listen for confirmation responses
		eventEmitter.on(Events.CONFIRMATION_RESPONDED, (payload: ConfirmationResponsePayload) => {
			this.handleConfirmationResponse(payload);
		});

		// Listen for confirmation requests
		eventEmitter.on(Events.CONFIRMATION_REQUESTED, (payload: ConfirmationRequestPayload) => {
			this.handleConfirmationRequest(payload);
		});
	}

	/**
	 * Handle a confirmation request
	 * @param payload The request payload
	 */
	private async handleConfirmationRequest(payload: ConfirmationRequestPayload): Promise<void> {
		// Extract onConfirmEvent from context if present
		const { onConfirmEvent, ...restOfContext } = payload.context || {};

		// Store the confirmation in memory
		const confirmation: PendingConfirmation = {
			id: payload.id,
			type: payload.type,
			conversationTitle: payload.conversationTitle,
			message: payload.message,
			context: restOfContext,
			createdAt: Date.now(),
		};

		// Add event if provided
		if (onConfirmEvent) {
			confirmation.onConfirmEvent = onConfirmEvent;
		}

		this.pendingConfirmations.set(payload.id, confirmation);

		// Update the conversation with the confirmation message
		await this.plugin.updateConversationNote({
			path: payload.conversationTitle,
			newContent: payload.message,
			role: 'Steward',
			command: 'confirm',
		});
	}

	/**
	 * Request a confirmation from the user
	 * @param conversationTitle The conversation title
	 * @param type The type of confirmation (e.g., 'move-folders')
	 * @param message The message to show the user
	 * @param context Data needed for the confirmation
	 * @returns The confirmation ID
	 */
	async requestConfirmation(
		conversationTitle: string,
		type: string,
		message: string,
		context: any,
		onConfirmEvent?: {
			eventType: keyof EventPayloadMap;
			payload: any;
		}
	): Promise<string> {
		// Generate a unique ID
		const id = `${type}_${Date.now()}`;

		// Emit the confirmation request event
		eventEmitter.emit(Events.CONFIRMATION_REQUESTED, {
			id,
			conversationTitle,
			message,
			type,
			context: { ...context, onConfirmEvent },
		});

		return id;
	}

	/**
	 * Handle a confirmation response
	 * @param payload The response payload
	 * @returns Whether the response was handled
	 */
	private async handleConfirmationResponse(payload: ConfirmationResponsePayload): Promise<boolean> {
		const { id, confirmed, conversationTitle } = payload;

		// Get the confirmation
		const confirmation = this.pendingConfirmations.get(id);
		if (!confirmation) {
			return false; // Not found
		}

		// Remove it from pending
		this.pendingConfirmations.delete(id);

		// Get translation function using the language from the context or default
		const lang = confirmation.context?.lang || getObsidianLanguage();
		const t = getTranslation(lang);

		try {
			// Handle based on user's response
			if (confirmed) {
				// If there's an event to trigger, emit it
				if (confirmation.onConfirmEvent) {
					const { eventType, payload } = confirmation.onConfirmEvent;
					// Simply emit the event with the original payload
					eventEmitter.emit(eventType, payload);
				} else {
					// No event defined, just acknowledge
					await this.plugin.updateConversationNote({
						path: conversationTitle,
						newContent: `Confirmation received for "${confirmation.type}".`,
						role: 'Steward',
						command: 'confirm',
					});
				}
			} else {
				// User declined
				await this.plugin.updateConversationNote({
					path: conversationTitle,
					newContent: t('confirmation.operationCancelled'),
					role: 'Steward',
					command: 'confirm',
				});
			}
		} catch (error) {
			// Handle any errors during confirmation handling
			await this.plugin.updateConversationNote({
				path: conversationTitle,
				newContent: t('confirmation.errorProcessing', { errorMessage: error.message }),
				role: 'Steward',
				command: 'error',
			});
		}

		return true;
	}

	/**
	 * Check if a message is a clear confirmation response (yes/no)
	 * @param message The message to check
	 * @returns An object with the response type or null if not a clear response
	 */
	isConfirmIntent(message: string): { isConfirmation: boolean; isAffirmative: boolean } | null {
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

	/**
	 * Get pending confirmations for a specific conversation
	 * @param conversationTitle The conversation title
	 * @returns Array of pending confirmations for the conversation
	 */
	getPendingConfirmationsForConversation(conversationTitle: string): PendingConfirmation[] {
		return Array.from(this.pendingConfirmations.values()).filter(
			conf => conf.conversationTitle === conversationTitle
		);
	}
}
