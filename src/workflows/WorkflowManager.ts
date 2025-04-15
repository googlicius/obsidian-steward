import { App, Notice } from 'obsidian';
import {
	WorkflowEngine,
	WorkflowDefinition,
	WorkflowContext,
	WorkflowInput,
	WorkflowOutput,
} from './WorkflowEngine';
import { createFolderCheckWorkflow } from './FolderCheckWorkflow';

export class WorkflowManager {
	private workflowEngine: WorkflowEngine;

	constructor(
		private app: App,
		private plugin: any
	) {
		this.workflowEngine = new WorkflowEngine(app);
		this.registerDefaultWorkflows();
	}

	/**
	 * Register default workflows
	 */
	private registerDefaultWorkflows(): void {
		// Register the folder check workflow
		const folderCheckWorkflow = createFolderCheckWorkflow(this.plugin);
		this.registerWorkflow(folderCheckWorkflow);

		// Add more workflow registrations here as they are implemented
		// Example: this.registerWorkflow(createMoveFilesWorkflow(this.plugin));
	}

	/**
	 * Register a new workflow with the workflow engine
	 */
	registerWorkflow(workflow: WorkflowDefinition): void {
		this.workflowEngine.registerWorkflow(workflow);
	}

	/**
	 * Start a workflow by its ID
	 * @param workflowId The ID of the workflow to start
	 * @param input The initial input to the workflow
	 * @param context Additional context data
	 */
	async startWorkflow(
		workflowId: string,
		input: WorkflowInput,
		contextData: Partial<Omit<WorkflowContext, 'plugin'>> = {}
	): Promise<WorkflowOutput> {
		try {
			// Ensure context has plugin reference
			const context: Partial<WorkflowContext> & { plugin: any } = {
				...contextData,
				plugin: this.plugin,
			};

			return await this.workflowEngine.startWorkflow(workflowId, input, context);
		} catch (error) {
			console.error(`Error starting workflow ${workflowId}:`, error);

			// If there's an active conversation, notify the user
			if (contextData.conversationTitle) {
				await this.plugin.updateConversationNote(
					contextData.conversationTitle,
					`Error starting workflow: ${error.message}`,
					'Steward'
				);
			} else {
				new Notice(`Error starting workflow: ${error.message}`);
			}

			throw error;
		}
	}

	/**
	 * Check if a user's response relates to an active workflow confirmation
	 * and handle it appropriately
	 *
	 * @param conversationTitle The title of the conversation
	 * @param userResponse The user's response text
	 * @returns Whether the response was handled by a workflow
	 */
	async handleUserResponse(conversationTitle: string, userResponse: string): Promise<boolean> {
		try {
			const result = await this.workflowEngine.handleUserResponse(conversationTitle, userResponse);

			return result.handled;
		} catch (error) {
			console.error(`Error handling user response for conversation ${conversationTitle}:`, error);

			await this.plugin.updateConversationNote(
				conversationTitle,
				`Error processing your response: ${error.message}`,
				'Steward'
			);

			return true; // Considered handled even though it errored
		}
	}

	/**
	 * Check if there's a pending confirmation for a conversation
	 */
	isConfirmationPending(conversationTitle: string): boolean {
		return this.workflowEngine.isConfirmationPending(conversationTitle);
	}

	/**
	 * Get all available workflow IDs
	 */
	getAvailableWorkflows(): string[] {
		// This would need to be implemented in the WorkflowEngine
		// For now, return an empty array
		return [];
	}
}
