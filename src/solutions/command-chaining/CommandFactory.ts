import { CommandPipeline, PipelineContext } from './CommandPipeline';
import { ReferenceResolutionStep, SearchStep, MovePreparationStep } from './steps';
import { ConversationContextManager } from './ConversationContextManager';
import StewardPlugin from '../../main';

/**
 * Factory for creating command pipelines
 */
export class CommandFactory {
	private plugin: StewardPlugin;
	private contextManager: ConversationContextManager;

	constructor(plugin: StewardPlugin) {
		this.plugin = plugin;
		this.contextManager = new ConversationContextManager();
	}

	/**
	 * Creates a search command pipeline
	 * @param conversationTitle The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code
	 */
	public createSearchPipeline(
		conversationTitle: string,
		commandContent: string,
		lang?: string
	): { pipeline: CommandPipeline; context: PipelineContext } {
		const context: PipelineContext = {
			conversationTitle,
			contextManager: this.contextManager,
			originalCommand: commandContent,
			commandType: 'search',
			stepResults: new Map(),
			lang,
			plugin: this.plugin,
		};

		// Create and configure the pipeline
		const pipeline = new CommandPipeline();

		pipeline
			// Optional step to resolve references if present
			.addStep(ReferenceResolutionStep)
			// Execute the search
			.addStep(SearchStep);
		// Add more steps as needed

		return { pipeline, context };
	}

	/**
	 * Creates a move command pipeline
	 * @param conversationTitle The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code
	 */
	public createMovePipeline(
		conversationTitle: string,
		commandContent: string,
		lang?: string
	): { pipeline: CommandPipeline; context: PipelineContext } {
		const context: PipelineContext = {
			conversationTitle,
			contextManager: this.contextManager,
			originalCommand: commandContent,
			commandType: 'move',
			stepResults: new Map(),
			lang,
			plugin: this.plugin,
		};

		// Create and configure the pipeline
		const pipeline = new CommandPipeline();

		pipeline
			// Check if this command references previous results
			.addStep(ReferenceResolutionStep)
			// Prepare the move operation
			.addStep(MovePreparationStep);
		// Add confirmation steps, execution steps, etc.

		return { pipeline, context };
	}

	/**
	 * Factory method to create the appropriate pipeline based on command type
	 * @param commandType The type of command
	 * @param conversationTitle The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code
	 */
	public createPipeline(
		commandType: string,
		conversationTitle: string,
		commandContent: string,
		lang?: string
	): { pipeline: CommandPipeline; context: PipelineContext } {
		switch (commandType) {
			case 'search':
				return this.createSearchPipeline(conversationTitle, commandContent, lang);
			case 'move':
				return this.createMovePipeline(conversationTitle, commandContent, lang);
			// Add cases for other command types
			default:
				throw new Error(`Unsupported command type: ${commandType}`);
		}
	}

	/**
	 * Creates and executes a pipeline for a command
	 * @param commandType The type of command
	 * @param conversationTitle The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code
	 */
	public async executePipeline(
		commandType: string,
		conversationTitle: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		const { pipeline, context } = this.createPipeline(
			commandType,
			conversationTitle,
			commandContent,
			lang
		);

		// Execute the pipeline with the context
		await pipeline.execute(context);
	}
}
