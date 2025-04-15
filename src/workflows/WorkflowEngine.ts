import { App } from 'obsidian';

export type WorkflowInput = any;
export type WorkflowOutput = any;

export interface WorkflowStepResult {
	success: boolean;
	output: WorkflowOutput;
	error?: Error;
}

export interface WorkflowContext {
	conversationTitle: string;
	originalInput: string;
	plugin: any; // Reference to the plugin instance
	[key: string]: any;
}

export interface WorkflowStepOptions {
	id: string;
	name?: string;
	skipIf?: (context: WorkflowContext, previousResult?: WorkflowStepResult) => boolean;
	onError?: (error: Error, context: WorkflowContext) => Promise<WorkflowStepResult>;
}

export abstract class WorkflowStep {
	readonly id: string;
	readonly name: string;
	private skipCondition?: (
		context: WorkflowContext,
		previousResult?: WorkflowStepResult
	) => boolean;
	private errorHandler?: (error: Error, context: WorkflowContext) => Promise<WorkflowStepResult>;

	constructor(options: WorkflowStepOptions) {
		this.id = options.id;
		this.name = options.name || options.id;
		this.skipCondition = options.skipIf;
		this.errorHandler = options.onError;
	}

	shouldSkip(context: WorkflowContext, previousResult?: WorkflowStepResult): boolean {
		return this.skipCondition ? this.skipCondition(context, previousResult) : false;
	}

	async execute(input: WorkflowInput, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			return await this.run(input, context);
		} catch (error) {
			console.error(`Error in workflow step ${this.id}:`, error);

			if (this.errorHandler) {
				return await this.errorHandler(error, context);
			}

			return {
				success: false,
				output: null,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	abstract run(input: WorkflowInput, context: WorkflowContext): Promise<WorkflowStepResult>;
}

export class ConfirmationStep extends WorkflowStep {
	private getMessage: (input: any, context: WorkflowContext) => string;

	constructor(
		options: WorkflowStepOptions & {
			getMessage: (input: any, context: WorkflowContext) => string;
		}
	) {
		super(options);
		this.getMessage = options.getMessage;
	}

	async run(input: WorkflowInput, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			const message = this.getMessage(input, context);

			// Add confirmation message to conversation
			await context.plugin.updateConversationNote(context.conversationTitle, message, 'Steward');

			// Store the current workflow state to resume after confirmation
			context.confirmationPending = true;
			context.confirmationStepId = this.id;
			context.confirmationInput = input;

			return {
				success: true,
				output: {
					awaitingConfirmation: true,
					originalInput: input,
					message,
				},
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}

export interface WorkflowDefinition {
	id: string;
	name: string;
	steps: WorkflowStep[];
}

export class WorkflowEngine {
	private workflows: Map<string, WorkflowDefinition> = new Map();
	private activeWorkflows: Map<
		string,
		{
			definition: WorkflowDefinition;
			context: WorkflowContext;
			currentStepIndex: number;
			lastResult?: WorkflowStepResult;
		}
	> = new Map();

	constructor(private app: App) {}

	registerWorkflow(workflow: WorkflowDefinition): void {
		this.workflows.set(workflow.id, workflow);
	}

	getWorkflow(id: string): WorkflowDefinition | undefined {
		return this.workflows.get(id);
	}

	async startWorkflow(
		workflowId: string,
		initialInput: WorkflowInput,
		context: Partial<WorkflowContext> & { plugin: any }
	): Promise<WorkflowOutput> {
		const workflow = this.workflows.get(workflowId);

		if (!workflow) {
			throw new Error(`Workflow "${workflowId}" not found`);
		}

		// Initialize full context
		const fullContext: WorkflowContext = {
			conversationTitle: '',
			originalInput: typeof initialInput === 'string' ? initialInput : JSON.stringify(initialInput),
			...context,
		};

		// Store active workflow
		const workflowState = {
			definition: workflow,
			context: fullContext,
			currentStepIndex: 0,
			lastResult: undefined,
		};

		this.activeWorkflows.set(fullContext.conversationTitle, workflowState);

		try {
			return await this.executeWorkflow(workflowState, initialInput);
		} catch (error) {
			console.error(`Error executing workflow ${workflowId}:`, error);

			// Clean up on error
			this.activeWorkflows.delete(fullContext.conversationTitle);

			throw error;
		}
	}

	private async executeWorkflow(
		state: {
			definition: WorkflowDefinition;
			context: WorkflowContext;
			currentStepIndex: number;
			lastResult?: WorkflowStepResult;
		},
		input: WorkflowInput
	): Promise<WorkflowOutput> {
		const { definition, context } = state;
		let currentInput = input;

		// Execute steps starting from the current index
		for (let i = state.currentStepIndex; i < definition.steps.length; i++) {
			const step = definition.steps[i];

			// Check if we should skip this step
			if (step.shouldSkip(context, state.lastResult)) {
				continue;
			}

			// Update current step index
			state.currentStepIndex = i;

			// Execute the step
			const result = await step.execute(currentInput, context);
			state.lastResult = result;

			// Handle step failure
			if (!result.success) {
				// Clean up
				this.activeWorkflows.delete(context.conversationTitle);

				throw result.error || new Error(`Step ${step.id} failed without a specific error`);
			}

			// If this is a confirmation step waiting for input, pause execution
			if (context.confirmationPending) {
				// Return early, workflow will resume when confirmation is received
				return {
					awaitingConfirmation: true,
					workflowId: definition.id,
					conversationTitle: context.conversationTitle,
				};
			}

			// Pass the output to the next step
			currentInput = result.output;
		}

		// Workflow completed successfully
		this.activeWorkflows.delete(context.conversationTitle);

		return state.lastResult?.output || null;
	}

	async handleUserResponse(
		conversationTitle: string,
		userResponse: string
	): Promise<{
		handled: boolean;
		result?: WorkflowOutput;
	}> {
		const workflowState = this.activeWorkflows.get(conversationTitle);

		if (!workflowState || !workflowState.context.confirmationPending) {
			return { handled: false };
		}

		// Normalize and check the user's response
		const normalizedResponse = userResponse.toLowerCase().trim();

		// Check for affirmative responses
		const isAffirmative = ['yes', 'y', 'sure', 'ok', 'okay', 'confirm', 'go ahead', 'do it'].some(
			term => normalizedResponse === term || normalizedResponse.includes(term)
		);

		// Check for negative responses
		const isNegative = ['no', 'n', 'nope', "don't", 'dont', 'cancel', 'stop'].some(
			term => normalizedResponse === term || normalizedResponse.includes(term)
		);

		if (!isAffirmative && !isNegative) {
			// If the message doesn't clearly indicate a yes/no response, treat as unhandled
			return { handled: false };
		}

		// Clear confirmation pending state
		workflowState.context.confirmationPending = false;

		if (isNegative) {
			// User declined, end workflow
			this.activeWorkflows.delete(conversationTitle);

			// Notify the user
			await workflowState.context.plugin.updateConversationNote(
				conversationTitle,
				'Operation cancelled.',
				'Steward'
			);

			return {
				handled: true,
				result: {
					cancelled: true,
					message: 'Operation cancelled by user.',
				},
			};
		}

		// User confirmed, continue workflow
		// Move to the next step
		workflowState.currentStepIndex++;

		// Continue execution
		const result = await this.executeWorkflow(
			workflowState,
			workflowState.context.confirmationInput
		);

		return {
			handled: true,
			result,
		};
	}

	isConfirmationPending(conversationTitle: string): boolean {
		const workflowState = this.activeWorkflows.get(conversationTitle);
		return !!(workflowState && workflowState.context.confirmationPending);
	}
}
