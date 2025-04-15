import {
	WorkflowStep,
	WorkflowStepResult,
	WorkflowContext,
	ConfirmationStep,
} from './WorkflowEngine';
import { GeneratorText } from '../main';

/**
 * A step that updates the conversation with a message
 */
export class UpdateConversationStep extends WorkflowStep {
	private getMessage: (input: any, context: WorkflowContext) => string;
	private role: string;

	constructor(options: {
		id: string;
		name?: string;
		getMessage: (input: any, context: WorkflowContext) => string;
		role?: string;
	}) {
		super({
			id: options.id,
			name: options.name,
		});
		this.getMessage = options.getMessage;
		this.role = options.role || 'Steward';
	}

	async run(input: any, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			const message = this.getMessage(input, context);

			await context.plugin.updateConversationNote(context.conversationTitle, message, this.role);

			return {
				success: true,
				output: input, // Pass through the input to next step
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error,
			};
		}
	}
}

/**
 * A step that adds a generating indicator to the conversation
 */
export class AddGeneratingIndicatorStep extends WorkflowStep {
	private indicator: GeneratorText;

	constructor(options: { id: string; name?: string; indicator: GeneratorText }) {
		super({
			id: options.id,
			name: options.name,
		});
		this.indicator = options.indicator;
	}

	async run(input: any, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			await context.plugin.addGeneratingIndicator(context.conversationTitle, this.indicator);

			return {
				success: true,
				output: input, // Pass through the input to next step
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error,
			};
		}
	}
}

/**
 * A step that checks if a folder exists and requests confirmation to create it if it doesn't
 */
export class FolderExistenceStep extends WorkflowStep {
	private getFolderPath: (input: any, context: WorkflowContext) => string;

	constructor(options: {
		id: string;
		name?: string;
		getFolderPath: (input: any, context: WorkflowContext) => string;
	}) {
		super({
			id: options.id,
			name: options.name,
		});
		this.getFolderPath = options.getFolderPath;
	}

	async run(input: any, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			const folderPath = this.getFolderPath(input, context);

			// Store folder path in context for later use
			context.folderPath = folderPath;

			// Check if folder exists
			const folderExists = context.plugin.app.vault.getAbstractFileByPath(folderPath);

			if (!folderExists) {
				// Use a confirmation step to ask if we should create the folder
				const confirmation = new ConfirmationStep({
					id: `${this.id}_confirmation`,
					name: `${this.name || this.id} Confirmation`,
					getMessage: () =>
						`The folder \`${folderPath}\` doesn't exist. Would you like me to create it?`,
				});

				// Execute the confirmation step directly
				return await confirmation.execute(input, context);
			}

			// Folder exists, just return the input
			return {
				success: true,
				output: input,
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error,
			};
		}
	}
}

/**
 * A step that creates a folder
 */
export class CreateFolderStep extends WorkflowStep {
	private getFolderPath: (input: any, context: WorkflowContext) => string;

	constructor(options: {
		id: string;
		name?: string;
		getFolderPath: (input: any, context: WorkflowContext) => string;
	}) {
		super({
			id: options.id,
			name: options.name,
		});
		this.getFolderPath = options.getFolderPath;
	}

	async run(input: any, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			// Get folder path either from the context (if set by FolderExistenceStep)
			// or by calling the provided function
			const folderPath = context.folderPath || this.getFolderPath(input, context);

			// Create the folder
			await context.plugin.app.vault.createFolder(folderPath);

			// Update the conversation
			await context.plugin.updateConversationNote(
				context.conversationTitle,
				`Created folder \`${folderPath}\`.`,
				'Steward'
			);

			return {
				success: true,
				output: input,
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error,
			};
		}
	}
}

/**
 * A step that extracts the intent of a command using AI
 */
export class ExtractIntentStep extends WorkflowStep {
	constructor(options: { id: string; name?: string }) {
		super({
			id: options.id,
			name: options.name,
		});
	}

	async run(input: string, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			await context.plugin.addGeneratingIndicator(
				context.conversationTitle,
				GeneratorText.ExtractingIntent
			);

			const intentExtraction = await context.plugin.obsidianAPITools.extractCommandIntent(input);

			return {
				success: true,
				output: intentExtraction,
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error,
			};
		}
	}
}
