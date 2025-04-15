import { eventEmitter, Events } from './EventEmitter';
import {
	ConfirmationRequestPayload,
	ConfirmationResponsePayload,
	EventPayloadMap,
} from '../types/events';
import StewardPlugin from '../main';

interface PendingConfirmation {
	id: string;
	type: string; // Descriptive type (e.g., 'move-folders')
	conversationTitle: string;
	message: string;
	context: any;
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
		const { onConfirmEvent, ...restContext } = payload.context || {};

		// Store the confirmation in memory
		const confirmation: PendingConfirmation = {
			id: payload.id,
			type: payload.type,
			conversationTitle: payload.conversationTitle,
			message: payload.message,
			context: restContext, // Store the original context without the internal properties
			createdAt: Date.now(),
		};

		// Add event if provided
		if (onConfirmEvent) {
			confirmation.onConfirmEvent = onConfirmEvent;
		}

		this.pendingConfirmations.set(payload.id, confirmation);

		// Update the conversation with the confirmation message
		await this.plugin.updateConversationNote(payload.conversationTitle, payload.message, 'Steward');
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

		try {
			// Handle based on user's response
			if (confirmed) {
				// If there's an event to trigger, emit it
				if (confirmation.onConfirmEvent) {
					const { eventType, payload } = confirmation.onConfirmEvent;
					eventEmitter.emit(eventType, payload);
				} else {
					// No event defined, just acknowledge
					await this.plugin.updateConversationNote(
						conversationTitle,
						`Confirmation received for "${confirmation.type}".`,
						'Steward'
					);
				}
			} else {
				// User declined
				await this.plugin.updateConversationNote(
					conversationTitle,
					`Operation cancelled.`,
					'Steward'
				);
			}
		} catch (error) {
			// Handle any errors during confirmation handling
			await this.plugin.updateConversationNote(
				conversationTitle,
				`Error processing confirmation: ${error.message}`,
				'Steward'
			);
		}

		return true;
	}

	/**
	 * Check if a message is a clear confirmation response (yes/no)
	 * @param message The message to check
	 * @returns An object with the response type or null if not a clear response
	 */
	isConfirmationResponse(
		message: string
	): { isConfirmation: boolean; isAffirmative: boolean } | null {
		// Parse the user's response
		const normalized = message.toLowerCase().trim();

		const isAffirmative = [
			'yes',
			'y',
			'sure',
			'ok',
			'yeah',
			'yep',
			'create',
			'confirm',
			'proceed',
		].some(term => normalized === term || normalized.includes(term));

		const isNegative = ['no', 'n', 'nope', "don't", 'dont', 'cancel', 'stop'].some(
			term => normalized === term || normalized.includes(term)
		);

		// If not a clear response, return null
		if (!isAffirmative && !isNegative) {
			return null;
		}

		// Return the confirmation type
		return {
			isConfirmation: true,
			isAffirmative,
		};
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
