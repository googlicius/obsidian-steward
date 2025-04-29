import { App, Notice } from 'obsidian';
import { eventEmitter, Events, ErrorEvents } from '../../services/EventEmitter';
import {
	GitOperationPerformedPayload,
	GitOperationRevertedPayload,
	MoveOperationCompletedPayload,
} from '../../types/events';
import { GitOperation, GitService } from './GitService';
import { ConversationRenderer } from '../../services/ConversationRenderer';
import { logger } from '../../utils/logger';
import StewardPlugin from '../../main';

/**
 * Handler for Git-related events to enable tracking and reverting changes
 */
export class GitEventHandler {
	private gitService: GitService;
	private renderer: ConversationRenderer;

	constructor(app: App, plugin: StewardPlugin) {
		this.gitService = GitService.getInstance(app);

		this.renderer = new ConversationRenderer(plugin);

		this.setupListeners();
	}

	/**
	 * Initialize the Git service and set up event listeners
	 */
	private setupListeners(): void {
		// Initialize Git service
		this.gitService.initialize().catch(error => {
			logger.error('Failed to initialize Git service', error);
		});

		// Listen for move operations AFTER they've been completed
		eventEmitter.on(Events.MOVE_OPERATION_COMPLETED, this.handleMoveOperationCompleted.bind(this));

		// Listen for Git operations performed
		eventEmitter.on(Events.GIT_OPERATION_PERFORMED, this.handleGitOperationPerformed.bind(this));

		// Listen for Git operations reverted
		eventEmitter.on(Events.GIT_OPERATION_REVERTED, this.handleGitOperationReverted.bind(this));
	}

	/**
	 * Handle move operations after they've been completed
	 * @param payload The payload from the move operation completed event
	 */
	private async handleMoveOperationCompleted(
		payload: MoveOperationCompletedPayload
	): Promise<void> {
		try {
			// Create a Git operation for the completed move
			let description = 'Moved files:';
			const affectedFiles: string[] = [];

			// Process the operations that were completed
			payload.operations.forEach(operation => {
				// Add the moved files to our list of affected files
				affectedFiles.push(...operation.moved);

				// Add some details to the description
				description += ` ${operation.moved.length} files to ${operation.destinationFolder};`;
			});

			// Only proceed if there were actually files moved
			if (affectedFiles.length === 0) {
				logger.log('No files were moved, skipping Git commit');
				return;
			}

			// Create the Git operation
			const operation: GitOperation = {
				type: 'move',
				affectedFiles,
				description,
				timestamp: Date.now(),
			};

			// Track the operation - this will actually create the commit
			const commitHash = await this.gitService.trackOperation(operation);

			if (commitHash) {
				// Emit event for successful Git operation
				eventEmitter.emit(Events.GIT_OPERATION_PERFORMED, {
					operation,
					commitHash,
				});

				// Store the commit hash in the conversation metadata
				if (payload.title) {
					const messageMetadata = await this.renderer.findMostRecentMessageMetadata(
						payload.title,
						'move',
						'steward' // lowercase to match how it's stored
					);

					if (messageMetadata && messageMetadata.ID) {
						await this.addCommitHashToMetadata(payload.title, messageMetadata.ID, commitHash);
					}
				}
			}
		} catch (error) {
			logger.error('Error tracking move operation in Git:', error);
			eventEmitter.emit(ErrorEvents.GIT_ERROR, {
				error: error as Error,
			});
		}
	}

	/**
	 * Handle Git operation performed event - update conversation metadata
	 * @param payload The Git operation performed payload
	 */
	private async handleGitOperationPerformed(payload: GitOperationPerformedPayload): Promise<void> {
		try {
			// Find the conversation that triggered the operation
			// This could be expanded to handle other types of operations
			// For now, we're just adding commit hashes to conversation metadata
			if (payload.operation.type === 'move') {
				// Add commit hash to conversation metadata
				// In a real implementation, you'd need to find the relevant conversation
				// For now, this is left as a demonstration
				logger.log(`Operation performed and committed: ${payload.commitHash}`);
			}
		} catch (error) {
			logger.error('Error handling Git operation performed:', error);
		}
	}

	/**
	 * Handle Git operation reverted event
	 * @param payload The Git operation reverted payload
	 */
	private async handleGitOperationReverted(payload: GitOperationRevertedPayload): Promise<void> {
		// This could show a notification or update UI elements
		if (payload.success) {
			logger.log(`Successfully reverted to commit: ${payload.commitHash}`);
		} else {
			logger.error(`Failed to revert to commit: ${payload.commitHash}`);
		}
	}

	/**
	 * Add a commit hash to conversation metadata
	 * @param conversationTitle The conversation title
	 * @param messageId The message ID
	 * @param commitHash The commit hash
	 */
	public async addCommitHashToMetadata(
		conversationTitle: string,
		messageId: string,
		commitHash: string
	): Promise<void> {
		try {
			// Update metadata for the conversation message
			const metadata = await this.renderer.findMessageMetadataById(conversationTitle, messageId);

			if (metadata) {
				// Add or update the commit hash with only first 7 characters
				await this.renderer.updateMessageMetadata(conversationTitle, messageId, {
					...metadata,
					COMMIT: commitHash.substring(0, 7),
				});
			}
		} catch (error) {
			logger.error('Error adding commit hash to metadata:', error);
		}
	}

	/**
	 * Revert to the commit associated with a specific conversation message
	 * @param conversationTitle The conversation title
	 * @param messageId The message ID
	 */
	public async revertToMessage(conversationTitle: string, messageId: string): Promise<boolean> {
		try {
			// Find the message metadata
			const metadata = await this.renderer.findMessageMetadataById(conversationTitle, messageId);

			if (metadata && metadata.COMMIT) {
				// Revert to the commit
				const success = await this.gitService.revertToCommit(metadata.COMMIT);

				// Emit the revert event
				eventEmitter.emit(Events.GIT_OPERATION_REVERTED, {
					commitHash: metadata.COMMIT,
					success,
				});

				return success;
			}

			return false;
		} catch (error) {
			logger.error('Error reverting to message commit:', error);
			return false;
		}
	}

	/**
	 * Revert the last operation performed
	 * @returns True if the revert was successful
	 */
	public async revertLastOperation(): Promise<boolean> {
		try {
			// Delegate to the Git service
			const success = await this.gitService.revertLastOperation();

			// If successful, we could potentially fetch the commit details and emit more information
			if (success) {
				new Notice('Successfully reverted the last operation.');
			} else {
				new Notice('No operations to revert or revert failed.');
			}

			return success;
		} catch (error) {
			logger.error('Error reverting last operation:', error);
			new Notice(`Failed to revert last operation: ${error.message}`);
			return false;
		}
	}
}
