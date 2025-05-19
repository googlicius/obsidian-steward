import { App, Notice } from 'obsidian';
import { eventEmitter } from '../../services/EventEmitter';
import {
	GitOperationPerformedPayload,
	GitOperationRevertedPayload,
	MoveOperationCompletedPayload,
	CopyOperationCompletedPayload,
	DeleteOperationCompletedPayload,
} from '../../types/events';
import { GitOperation, GitService } from './GitService';
import { ConversationRenderer } from '../../services/ConversationRenderer';
import { logger } from '../../utils/logger';
import type StewardPlugin from '../../main';
import { Events, ErrorEvents } from '../../types/events';

/**
 * Handler for Git-related events to enable tracking and reverting changes
 */
export class GitEventHandler {
	private gitService: GitService;
	private renderer: ConversationRenderer;

	constructor(app: App, plugin: StewardPlugin) {
		this.gitService = GitService.getInstance(app);
		this.renderer = plugin.conversationRenderer;

		this.setupListeners();
	}

	/**
	 * Initialize the Git service and set up event listeners
	 */
	private setupListeners(): void {
		// Initialize Git service
		// this.gitService.initialize().catch(error => {
		// 	logger.error('Failed to initialize Git service', error);
		// });
		// eventEmitter.on(Events.MOVE_OPERATION_COMPLETED, this.handleMoveOperationCompleted.bind(this));
		// eventEmitter.on(Events.COPY_OPERATION_COMPLETED, this.handleCopyOperationCompleted.bind(this));
		// eventEmitter.on(
		// 	Events.DELETE_OPERATION_COMPLETED,
		// 	this.handleDeleteOperationCompleted.bind(this)
		// );
		// eventEmitter.on(Events.GIT_OPERATION_PERFORMED, this.handleGitOperationPerformed.bind(this));
		// eventEmitter.on(Events.GIT_OPERATION_REVERTED, this.handleGitOperationReverted.bind(this));
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
				// affectedFiles,
				description,
				timestamp: Date.now(),
			};

			// Track the operation - this will actually create the commit
			const commitHash = await this.gitService.trackOperation(operation);

			if (commitHash) {
				eventEmitter.emit(Events.GIT_OPERATION_PERFORMED, {
					operation,
					commitHash,
				});

				// Store the commit hash in the conversation metadata
				if (payload.title) {
					const messageMetadata = await this.renderer.findMostRecentMessageMetadata(
						payload.title,
						'move',
						'steward'
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
	 * Handle copy operations after they've been completed
	 * @param payload The payload from the copy operation completed event
	 */
	private async handleCopyOperationCompleted(payload: CopyOperationCompletedPayload) {
		const description = payload.operations
			.map(op => {
				const copied = op.copied.map(f => `- ${f}`).join('\n');
				return `Copied files from "${op.sourceQuery}" to "${op.destinationFolder}":\n${copied}`;
			})
			.join('\n\n');

		const commitHash = await this.trackOperationInGit({
			type: 'copy',
			description,
			// affectedFiles: payload.operations.flatMap(op => op.copied),
			timestamp: Date.now(),
		});

		if (commitHash && payload.title) {
			const messageMetadata = await this.renderer.findMostRecentMessageMetadata(
				payload.title,
				'copy',
				'steward'
			);

			if (messageMetadata?.ID) {
				await this.addCommitHashToMetadata(payload.title, messageMetadata.ID, commitHash);
			}
		}
	}

	/**
	 * Handle delete operations after they've been completed
	 * @param payload The payload from the delete operation completed event
	 */
	private async handleDeleteOperationCompleted(payload: DeleteOperationCompletedPayload) {
		const description = payload.operations
			.map(op => {
				const deleted = op.deleted.map(f => `- ${f}`).join('\n');
				return `Deleted files matching "${op.sourceQuery}":\n${deleted}`;
			})
			.join('\n\n');

		const commitHash = await this.trackOperationInGit({
			type: 'delete',
			description,
			// affectedFiles: payload.operations.flatMap(op => op.deleted),
			timestamp: Date.now(),
		});

		if (commitHash && payload.title) {
			const messageMetadata = await this.renderer.findMostRecentMessageMetadata(
				payload.title,
				'delete',
				'steward'
			);

			if (messageMetadata?.ID) {
				await this.addCommitHashToMetadata(payload.title, messageMetadata.ID, commitHash);
			}
		}
	}

	/**
	 * Handle Git operation performed event - update conversation metadata
	 * @param payload The Git operation performed payload
	 */
	private async handleGitOperationPerformed(payload: GitOperationPerformedPayload) {
		const { operation, commitHash } = payload;
		if (operation.type === 'move' || operation.type === 'delete') {
			logger.log(`Git operation ${operation.type} completed with commit hash: ${commitHash}`);
		}
	}

	/**
	 * Handle Git operation reverted event
	 * @param payload The Git operation reverted payload
	 */
	private async handleGitOperationReverted(payload: GitOperationRevertedPayload): Promise<void> {
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

			if (metadata && typeof metadata.COMMIT === 'string') {
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

	private async trackOperationInGit(operation: GitOperation): Promise<string | undefined> {
		try {
			const commitHash = await this.gitService.trackOperation(operation);

			if (commitHash) {
				eventEmitter.emit(Events.GIT_OPERATION_PERFORMED, {
					operation,
					commitHash,
				});
				return commitHash;
			}

			return undefined;
		} catch (error) {
			logger.error(`Error tracking ${operation.type} operation in Git:`, error);
			eventEmitter.emit(ErrorEvents.GIT_ERROR, {
				error: error as Error,
			});
			return undefined;
		}
	}
}
