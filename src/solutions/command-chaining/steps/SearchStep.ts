import { PipelineStep, PipelineContext } from '../CommandPipeline';
import { ResultType } from '../ConversationContextManager';
import { GeneratorText } from '../../../main';
import { StepType } from './StepTypes';

/**
 * Step for search operation
 */
export const SearchStep: PipelineStep = {
	type: StepType.SEARCH,

	execute: async (input: any, context: PipelineContext) => {
		// If we have a previous reference, use that input
		const resolvedInput = input.resolvedCommand || input;

		// Add generating indicator
		await context.plugin.addGeneratingIndicator(context.conversationTitle, GeneratorText.Searching);

		// Extract the search query
		const queryExtraction = await context.plugin.obsidianAPITools.extractSearchQuery(resolvedInput);

		// Perform the search
		const results = await context.plugin.searchIndexer.searchV2(queryExtraction.operations);

		// Store the results in the context manager
		const searchContext = {
			type: ResultType.SEARCH_RESULTS,
			data: {
				results,
				queryExtraction,
			},
			timestamp: Date.now(),
			description: queryExtraction.explanation,
		};

		context.contextManager.addContext(context.conversationTitle, searchContext);

		// Return the results for the next step
		return {
			results,
			queryExtraction,
		};
	},

	handleError: async (error: Error, input: any, context: PipelineContext) => {
		// Handle search errors
		await context.plugin.updateConversationNote(
			context.conversationTitle,
			`Error: ${error.message}`,
			'Steward'
		);
	},
};
