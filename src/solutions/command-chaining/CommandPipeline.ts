import { ConversationContextManager } from './ConversationContextManager';

/**
 * Interface representing a step in a command pipeline
 */
export interface PipelineStep<T = any, R = any> {
	// Unique identifier for the step type
	type: string;

	// Function to execute the step
	execute: (input: T, context: PipelineContext) => Promise<R>;

	// Optional condition to check if the step should be executed
	shouldExecute?: (input: T, context: PipelineContext) => Promise<boolean> | boolean;

	// Optional function to handle errors that occur during execution
	handleError?: (error: Error, input: T, context: PipelineContext) => Promise<void>;
}

/**
 * Context data passed between pipeline steps
 */
export interface PipelineContext {
	// The title of the conversation
	conversationTitle: string;

	// The conversation context manager
	contextManager: ConversationContextManager;

	// The initial command content
	originalCommand: string;

	// The type of the command (move, search, etc.)
	commandType: string;

	// Results from previous steps in the pipeline
	stepResults: Map<string, any>;

	// Optional language code for i18n
	lang?: string;

	// Any additional data needed for the pipeline
	[key: string]: any;
}

/**
 * Manages the execution of a pipeline of steps for a command
 */
export class CommandPipeline {
	private steps: PipelineStep[] = [];

	/**
	 * Adds a step to the pipeline
	 * @param step The step to add
	 */
	public addStep(step: PipelineStep): CommandPipeline {
		this.steps.push(step);
		return this;
	}

	/**
	 * Executes the pipeline with the given context
	 * @param context The context for the pipeline
	 */
	public async execute(context: PipelineContext): Promise<void> {
		let currentInput: any = context.originalCommand;

		// Execute each step in order
		for (const step of this.steps) {
			try {
				// Check if the step should be executed
				const shouldExecute = step.shouldExecute
					? await step.shouldExecute(currentInput, context)
					: true;

				if (shouldExecute) {
					// Execute the step
					const result = await step.execute(currentInput, context);

					// Store the result in the context
					context.stepResults.set(step.type, result);

					// Update the input for the next step
					currentInput = result;
				}
			} catch (error) {
				// Handle the error if a handler is defined
				if (step.handleError) {
					await step.handleError(error, currentInput, context);
				} else {
					// Re-throw the error if no handler is defined
					throw error;
				}
			}
		}
	}
}
